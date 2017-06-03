Overview
--------

The package has 2 goals:

 * Provide a thin wrapper for the [jsforce](https://jsforce.github.io) library
 * Allow for automatic synchronization of Salesforce entities into the local Meteor
 MongoDB

(TODO: separate the synchro part into its own, Meteor-agnostic npm module)

Usage
-----

#### Install meteor package:

        meteor add nicocrm:syncforce
        
#### Install dependencies

        npm install --save simpl-schema log lodash

#### Initialize connection:

        import {SyncForce} from 'meteor/nicocrm:syncforce'

        SyncForce.login({
            login_url: 'https://test.salesforce.com',
            user: 'myuser@domain.com',
            password: 'somePassword',
            token: 'XXXXXXXXXXXXXXX'
        }

Run a query (this simply wraps the jsforce method using Meteor async wrapper):

        var recs = SyncForce.query('select Id, Name from Account');

[See jsforce doc](https://jsforce.github.io) for more information about the methods
provided.

#### Initialize a collection sync:

        SyncForce.syncCollection(myCollection, 'Account', "Status = 'Active'", options);

There are a few available options - see the method documentation in the source code
for details.  By default the sync will then run every 5 minutes.  It is possible
and recommended to set up a push topic in Salesforce to get those changes pushed
immediately.
If a sync is already defined for the named resource it will be replaced.
The method will return a CollectionSync object which can be used to control the
sync state: start, stop, run.
Note that if you pass a condition it will be added to the query when determining which records to sync.  
So Status = Active is not a good example as the records that are made Inactive would never get removed from the 
local side!  More likely you would use that for a condition on recordtype.  You can also pass a transform function 
in the options to filter the retrieved records - if you don't want a record to be inserted you can return null.

#### Run a sync on demand:

        SyncForce.runSync('Account', (err, res) => { ... })

This will run the sync asynchronously (same as calling run on the object returned by
syncCollection).  The sync for that resource must have already been defined.

#### Customize logging

Pass a logger object to SyncForce:

        SyncForce.setLogger(log)

By default logging will use npm-log which just outputs to the console

#### Receive notifications for sync events

To get notified when a record is synced from Salesforce to the local collection:

        SyncForce.onSynced('updated', 'Contact', (record, {eventType, resourceType}}) => {
            // eventType is "updated"
            // resourceType is "Contact" - this is the Salesforce entity name
            // record is the record that was just updated
        })
        
Or:
       
        SyncForce.onSynced('inserted', 'Contact', handler)
       
To get notified when a record is removed from Salesforce, and that removal is performed on the local collection:

        Syncforce.onSynced('removed', 'Contact', handler)
        
The events are sent after the local operation has been completed.        