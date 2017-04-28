import {Meteor} from 'meteor/meteor'
import Logging from './logging'

// helper for subscription to SF topic
class Subscription {
  /**
   * @param collectionSync - CollectionSync object that will be used to process incoming records
   * @param connection - jsforce connection object, used to subscribe to the streaming topic
   * @param topic - topic name
   */
  constructor(collectionSync, connection, topic) {
    this.collectionSync = collectionSync
    this.connection = connection
    this.topic = topic
  }

  init() {
    this.subscription = this.connection
      .streaming.topic(this.topic)
      .subscribe(Meteor.bindEnvironment(message => this.processMessage(message)))
    Logging.debug('Subscribed to topic ' + this.topic)
  }

  deinit() {
    if (this.subscription) {
      this.subscription.cancel()
      this.subscription = null
    }
  }

  /**
   * Process streaming API event.
   */
  processMessage(message) {
    Logging.debug('Processing streaming message', message);
    var event = message.event
    var status = {updated: 0, inserted: 0, deleted: 0}
    switch (event.type) {
      case 'deleted':
        this.collectionSync.processDeletedRecords([message.sobject], status)
        break
      case 'updated':
      case 'inserted':
        this.collectionSync.processRecord(message.sobject, status)
        break
      default:
        Logging.debug('Other event type received', event)
        break
    }
    Logging.debug(this.topic + ': Processed streaming event', status)
  }
}

export default Subscription
