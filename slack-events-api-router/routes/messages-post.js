const respondOnError = require('../src/respond-on-error');
const routeMessage = require('../src/route-message');
const sendToSlack = require('../src/slack-send-message');
const validateTeam = require('../src/validate-team');

const botName = 'quackbot';
const botUserID = '<@U75V2FNET>';
const supportedEventTypes = [
    'message',
    'message.channels',
];

function route(api, request) {
    return new Promise(resolve => {
        if (typeof request.body !== 'object') {
            throw new Error('Unexepcted request format.');
        }

        console.log(JSON.stringify(request));

        // Slack sends a verification token with each request. We use this to verify
        // that the message is really coming from Slack and not someone else that
        // found our endpoint. The verification token is different for each
        // instance of Slack and can be found on the "Basic Information" page of the
        // app settings.
        if (request.body.token !== request.env.slackAppVerificationToken) {
            throw new Error('Invalid app verification token.');
        }

        // Slack asks us to verify the endpoint (once).
        if (request.body.type === 'url_verification') {
            console.log('Responding to Slack URL verification challenge....');
            resolve({ challenge: request.body.challenge });
            return;
        }

    if (request.body.type !== 'event_callback' || typeof request.body.event !== 'object') {
      throw new Error(`Unexpected event type: ${request.body.type}`);
    }

    // Event subscriptions are managed in the Slack App settings.
    if (supportedEventTypes.indexOf(request.body.event.type) === -1) {
      throw new Error(`Unsupported event type: ${request.body.event.type}`);
    }

    // Skip altered messages for now to avoid bot confusion
    if (request.body.event.hasOwnProperty('subtype')) {
        throw new Error(`Unsupported event subtype: ${request.body.event.subtype}`);
    }

    // Don't respond to other bots.
    if (request.body.event.bot_id) {
      console.log('Ignoring message from fellow bot, bye!');
      resolve();
      return;
    }


    validateTeam(request)
    .then(validation => {
        
        // add the authrization info to the event
        request.body.event.authorization = validation;
        
        // Extract command words.
        const commandWords = request.body.event.text.trim().split(/\s+/);

        request.body.event.command = {
            subject: commandWords[0],
            predicate: commandWords.splice(2).join(' '),
            verb: commandWords[1],
        };
        
        // To reach the bot, it must be a DM (in a "D" channel)
        // or an @-mention at the start of a line.
        if (request.body.event.channel.match(/^D*/)[0] !== "D" && commandWords[0] !== `<@${request.body.event.authorization.bot_user_id}>`) {
            console.log('Ignoring message that is none of my beeswax, bye!');
            resolve();
            return;
        }

        if (!validation.cleared) {
            console.log('Team not yet validated by DocumentCloud. Informing user ...');
            var message = "I'm still waiting for the folks at DocumentCloud to say you can use my services!";
            resolve(sendToSlack(request.body.event, message));
            return;
        } 

        // Add API Gateway stage to message. We'll need this to determine where to
        // route the message.
        console.log(`Event posted to ${request.context.stage} stage.`);
        request.body.event.stage = request.context.stage;

        routeMessage(request.body.event).catch(respondOnError).then(resolve);  

    }); 
    })
    .then(response => {
      // We should respond to Slack with 200 to indicate that we've received the
      // event. If we do not, Slack will retry three times with back-off.
      return response || 'OK';
    })
    .catch(error => {
    // We should *still* respond to Slack with 200, we'll just log it.
      console.error(error.message);
      return 'OK';
    });
}

module.exports = route;