const routeMessage = require('./src/route-message');
const sendToSlack = require('./src/slack-send-message');
const processWithNLP = require('./src/process-with-nlp');

var Sequelize = require('sequelize');

exports.handler =  function (event, context, callback) {
    var db        = require('./lib/models/db')(Sequelize);
    db.Team.findOne({ where: { slack_id: event.team_id } })
        .then( (team) => {
            if (team === null) {
            // bail.  We somehow got a message from a team
            // that didn't install the bot.
                return ("We somehow got a message from a team that didn't install Quackbot.");
            
            } else {
                return team.latestAuthorization().then(
                    (authorization) => {
                    
                        console.log("Authorization is \n", JSON.stringify(authorization));
                    
                        // add the authorization info to the event
                        event.authorization = authorization[0].details.bot;
                    
                        // Tell the team they're not cool enough.
                        if (!team.verified) {
                            console.log('Team not yet validated by DocumentCloud. Informing user ...');
                            var message = "Hi! I'm still waiting for the folks at DocumentCloud to say you can use my services. Reach out to them if you think you're getting this message in error.";
                            return sendToSlack(event, message);
                        } else {

                            console.log('Team Verified, handling message');

                            console.log('Event is:', event);
                            
                            // // handle file uploads - TODO make sure this works 
                            // if (is_direct_message_to_me && event.subtype == 'file_share') {
                            //     event.command = {
                            //         verb: event.file.filetype,
                            //         predicate: event.file.url_private
                            //     };
                            // }
                        

                            // handle an incoming response to a slack action we initiated
                            // ... which we know because block_actions won't get here without
                            // hitting the URL directly and having passed a valid token
                            if (event.type == "block_actions") {
                                
                                console.log("Handling block action.")
                                event.command = {}
                                event.command.verb = event.actions[0].action_id
                                event.command.predicate = event.actions[0].selected_option.value
                                return routeMessage(event)
                                    .catch( (error) => console.log(`error at block actions: ${error}`) );

                            } else {
                                
                                // Handling regular message
                                
                                // Extract command words.
                                const commandWords = event.text.trim().split(/\s+/);
                            
                                // To reach the bot, it must be a DM (in a "D" channel)
                                // or an @-mention at the start of a line.
                            
                                var is_direct_message_to_me = event.channel.match(/^D*/)[0] == "D";
                                var command_starts_with_me = (commandWords[0] == `<@${event.authorization.bot_user_id}>`);
                            
                                if (!is_direct_message_to_me && !command_starts_with_me) {
                                    return 'Ignoring message that is none of my beeswax, bye!';
                                }
                            
        
                                                        
                                // process the human's request with natural language processing
                                return processWithNLP(event)
                                    .then(nlpResult => {
                                
                                        event.nlp = nlpResult;
                                
                                        // copying to command object for existing bots
                                        event.command = {};
                                        event.command.verb = event.nlp.action || null;
                                        event.command.predicate = event.nlp.parameters.url || event.nlp.parameters.topic || null;
                                
                                        // send the speech or blocks message back to the user,
                                        // which we pull from the event
                                        sendToSlack(event);
                                        
                                        console.log(`Event posted to ${event.stage} stage with\nverb '${event.command.verb}'\npredicate ${event.command.predicate}.`);
                                
                                        // send the human's message to the router for further action
                                        return routeMessage(event).catch((error) => console.log(`Error in the routing function: ${error}` ) );
                                    });
                                
                            }    
                        }
                    }
                );
            }
        })
        .then(
            function(){
                db.sequelize.sync().then(function() {
                // console.log("handles before:", process._getActiveHandles().length);
                    return db.sequelize.close().then(function() {
                        // console.log("handles after:", process._getActiveHandles().length);
                    });
                });
            }
        )
        .then(message => {
            console.log(message);
            callback(null);
        })
        .catch(error => {
            console.error(error);
            callback(null);
            return Promise.resolve();
        });
};

