Package.describe({
  name: 'nicocrm:syncforce',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: 'Automate synchronization between Mongo and Salesforce Entities',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Npm.depends({
  'jsforce': '1.7.1',
  'lodash': '4.17.4',
  'log': '1.4.0'
});

Package.onUse(function (api) {
  //api.versionsFrom('1.3-rc.3');
  api.use('ecmascript');
  api.use('check');
  api.use('aldeed:simple-schema');
  api.use('matb33:collection-hooks');
  api.mainModule('syncforce-server.js', 'server');
  // API exported for both client and server
  // (the server file includes it, so that we don't have 2 main modules for the server)
  api.mainModule('syncforce-shared.js', 'client');
});

Package.onTest(function (api) {
  api.use('practicalmeteor:mocha')
  api.use('ecmascript');
  api.use('nicocrm:syncforce');
  // MUST specify the version when testing, or Meteor will load the oldest version it can find!
  api.use('aldeed:simple-schema@1.5.3');
  api.use('matb33:collection-hooks@0.8.4');
  api.mainModule('syncforce-tests.js', ['client', 'server']);
  api.mainModule('syncforce-server-tests.js', 'server');
});
