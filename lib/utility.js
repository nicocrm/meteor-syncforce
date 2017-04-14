import forIn from 'lodash/forIn'
import isObject from 'lodash/isObject'
import omitBy from 'lodash/omitBy'

// extract any retrieved collection into an array of records
// (this is used to clean records received from SF)
export function cleanSfRecord(obj) {
  forIn(obj, (val, key) => {
    if (isObject(val) && val.records) {
      obj[key] = val.records.map(this.cleanSfRecord);
    }
  });
  return obj;
}

// return copy of object with fields that are not safe for inserting into SF:
// the ones that start with an underscore, end with __r, contains an object
// or is undefined
export function removeNonSfKeys(record) {
  // don't get the ones that start with a _
  return omitBy(record, (v, k) => k[0] == '_' ||
    k.substring(k.length - 3) == '__r' ||
    isObject(v) ||
    v === undefined)
  // return _.pickBy(record,  (v, k) => k == 'Name'
  //     || k == 'Id'
  //     || /__c$/.test(k));
}
