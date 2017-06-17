Package.describe({
  name: 'nicocrm:syncforce',
  version: '0.0.20',
  // Brief, one-line summary of the package.
  summary: 'Automate synchronization between Mongo and Salesforce Entities',
  // URL to the Git repository containing the source code for this package.
  git: 'https://github.com/nicocrm/meteor-syncforce',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Npm.depends({
  'jsforce': '1.8.0'
});

Package.onUse(function (api) {
  api.versionsFrom('1.4.4.1');
  api.use('ecmascript');
  api.use('check');
  api.use('matb33:collection-hooks@0.8.4');
  api.use('tmeasday:check-npm-versions@0.3.1');
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
  api.use('matb33:collection-hooks@0.8.4');
  api.mainModule('syncforce-tests.js', ['client', 'server']);
  api.mainModule('syncforce-server-tests.js', 'server');
});
