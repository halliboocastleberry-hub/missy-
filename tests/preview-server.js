'use strict';
/** Developer preview: same as the Chrome edition, but keeps test data in ./.preview-data. */
const path = require('path');
if (!process.env.MISSY_DATA) process.env.MISSY_DATA = path.join(__dirname, '..', '.preview-data');
require('../src/web/server');
