import forIn from 'lodash/forIn'
import isArray from 'lodash/isArray'
import isObject from 'lodash/isObject'
import isString from 'lodash/isString'
import omitBy from 'lodash/omitBy'
import mapValues from 'lodash/mapValues'

// extract any retrieved collection into an array of records
// (this is used to clean records received from SF)
// note that this will mutate the given object
export function cleanSfRecord(obj) {
  forIn(obj, (val, key) => {
    if (isObject(val) && val.records) {
      obj[key] = val.records.map(this.cleanSfRecord);
    }
  });
  return obj;
}

// used to strip the bogus time stamps that are getting sent with the date data for streaming
// events
export function cleanTimeStampInDateFields(obj) {
  return mapValues(obj, val => isString(val) ? val.replace(/^(\d{4}-\d{2}-\d{2})T00:00:00\.000\+0000$/, '$1') : val)
}

// return copy of object with fields that are not safe for inserting into SF:
// the ones that start with an underscore, end with __r, contains an object
// or is undefined
export function removeNonSfKeys(record) {
  // don't get the ones that start with a _
  return omitBy(record, (v, k) => k[0] == '_' ||
    k.substring(k.length - 3) == '__r' ||
    // don't get the ones that have a period, they are modifier for nested documents
    k.indexOf('.') > -1 ||
    isArray(v) ||
    isObject(v) ||
    v === undefined)
  // return _.pickBy(record,  (v, k) => k == 'Name'
  //     || k == 'Id'
  //     || /__c$/.test(k));
}
