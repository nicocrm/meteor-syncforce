/**
 * Helper function to retrieve the field metadata array for a given entity, given the metadata collection used
 * (assuming the MetadataSync class is used to populate said collection)
 * Note that on the client this will only work if there is an active subscription for the entity's data.
 */
export default function getFieldMetadata(metaCollection, entityName) {
  const entityMetadata = metaCollection.findOne({fullName: entityName})
  if(!entityMetadata) {
    throw new Error('Unable to load metadata for ' + entityName)
  }
  return entityMetadata.fields || []
}
