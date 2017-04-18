import SimpleSchema from 'simpl-schema'

/**
 * Build the simple schema based on the field metadata (an array of fields)
 *  - by default properties will be included as a string property
 *  - unless the required flag is true, the property will be marked optional
 *  - for a date property a regex will be included to ensure it is passed in the correct format to SF
 *  - for a lookup property an associated property named [SF relationship property name] will be created,
 *    with a sub schema of Name + Id.  For example AccountId => Account = { Name, Id }, Record_Owner__c => Record_Owner__r = {Name, Id}
 * @param fieldMetadata object - metadata obtained with getFieldMetadata
 * @param allowMissingRequiredFields [bool] if true, fields will all be marked as optional
 * @return SimpleSchema object
 */
export default function buildEntitySchema(fieldMetadata, allowMissingRequiredFields = true) {
  const schema = fieldMetadata.reduce((current, field) => {
    let fieldDef = {type: getTypeForField(field.type), optional: field.required !== 'true'}
    if (field.label)
      fieldDef.label = field.label
    switch (field.type) {
      case 'Lookup':
        // add field for the lookup entity
        current[field.fullName.replace(/Id$/, '').replace(/__c$/, '__r')] = {
          type: lookupSchema,
          optional: allowMissingRequiredFields || field.required !== 'true',
          label: field.label || field.fullName
        }
        break;
      case 'Date':
        fieldDef.regEx = /\d{4}-\d{2}-\d{2}/
        break
      case 'Summary':
      case 'Formula':
        // do not include those in the schema, so that they are cleaned out on update
        // note that they will also not be automatically refreshed until the entity itself is reloaded from SF
        // ideally we should have those automatically calculated using the SF definitions!
        // But that may be a bit much right now.
        fieldDef = null
        break
      case 'Currency':
      case 'Number':
        if (field.precision === "0")
          fieldDef.type = SimpleSchema.Integer
    }
    if(fieldDef && allowMissingRequiredFields)
      fieldDef.optional = true
    if (fieldDef)
      current[field.fullName] = fieldDef
    return current
  }, {})
  return new SimpleSchema(schema).extend({
    Id: {type: String, optional: true}
  })
}

function getTypeForField(type) {
  switch (type) {
    case 'Checkbox':
      return Boolean
    case 'Currency':
    case 'Number':
      return Number
    default:
      return String
  }
}

// for entity lookup we only include the name.
// Note that this will cause the other fields to be cleaned up when the schema is validated!
const lookupSchema = new SimpleSchema({
  Name: {type: String}, Id: {type: String}
})
