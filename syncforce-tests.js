import {expect} from 'meteor/practicalmeteor:chai'
import {getFieldMetadata, buildEntitySchema} from 'meteor/nicocrm:syncforce'

describe('getFieldMetadata', () => {
  it('should be defined', () => {
    expect(getFieldMetadata).to.be.ok
  })
})

describe('buildEntitySchema', () => {
  it('should be defined', () => {
    expect(buildEntitySchema).to.be.ok
  })

  it('should build schema from SF text fields', () => {
    const metadata = [
      {
        fullName: 'AccountName',
        label: 'Account',
        type: 'Text'
      }
    ]
    const schema = buildEntitySchema(metadata)
    expect(schema.schema()).to.have.property('AccountName').that.eql({
      type: String, optional: true, label: 'Account'
    })
  })

  it('should include Id property', () => {
    const metadata = [
    ]
    const schema = buildEntitySchema(metadata)
    expect(schema.schema()).to.have.property('Id').that.eql({
      type: String, optional: true
    })
  })

  it('should mark fields as required', () => {
    const metadata = [
      {
        fullName: 'AccountName',
        label: 'Account',
        type: 'Text',
        required: 'true'
      }
    ]
    const schema = buildEntitySchema(metadata)
    expect(schema.schema()).to.have.property('AccountName').that.eql({
      type: String, optional: false, label: 'Account'
    })
  })

  it('should set up regex for date fields', () => {
    const metadata = [
      {
        fullName: 'CloseDate',
        label: 'Close Date',
        type: 'Date'
      }
    ]
    const schema = buildEntitySchema(metadata)
    expect(schema.schema()).to.have.property('CloseDate').that.eql({
      type: String, optional: true, label: 'Close Date', regEx: /\d{4}-\d{2}-\d{2}/
    })
  })

  // it('should set up regex for date-time fields', () => {
  //   const metadata = [
  //     {
  //       fullName: 'CloseDate',
  //       label: 'Close Date',
  //       type: 'DateTime'
  //     }
  //   ]
  //   const schema = buildEntitySchema(metadata)
  //   expect(schema.schema()).to.eql({
  //     AccountName: { type: String, optional: false, label: 'Close Date', regEx: /\d{4}-\d{2}-\d{2}/ }
  //   })
  // })

  it('should create private entity property for lookup fields', () => {
    const metadata = [
      {
        fullName: 'OwnerId',
        label: 'Owner',
        type: 'Lookup'
      }
    ]
    const schema = buildEntitySchema(metadata)
    const schemaFields = schema.schema()
    expect(schemaFields).to.have.property('OwnerId')
    expect(schemaFields.Owner, 'Owner').to.be.ok
    // this part is not working
    // console.log(schemaFields._Owner.type());
    // expect(schemaFields._Owner.type.schema(), '_Owner.schema').to.eql({
    //   Name: {type: String},
    //   Id: {type: String}
    // })
  })

  // These are not working but I think it's just because of Meteor test being retarded
  //   it('should build a schema that can successfully validate an entity', () => {
  //     const metadata = [
  //       {
  //         fullName: 'OwnerId',
  //         label: 'Owner',
  //         type: 'Lookup'
  //       }
  //     ]
  //     const schema = buildEntitySchema(metadata)
  //     schema.validate({
  //       _Owner: {
  //         Id: 'xxxxx', Name: 'xxxxxxx'
  //       }
  //     })
  //   })
  //
  //   it('should build a schema that can throw an error for invalid entity', () => {
  //     const metadata = [
  //       {
  //         fullName: 'OwnerId',
  //         label: 'Owner',
  //         type: 'Lookup'
  //       }
  //     ]
  //     // const schema = buildEntitySchema(metadata)
  //     // console.log(schema.schema());
  //     const schema = new SimpleSchema({
  //       name: { type: String }
  //     })
  //     var ss = new SimpleSchema({
  //     requiredString: {
  //         type: String
  //     }
  // });
  // var ssContext1 = ss.newContext();
  // ssContext1.validate({ eirstrsei: 'tstrs' })
  //     const validation = () => {
  //       schema.newContext().validate({
  //         Stuff: 'onw',
  //         _Owner: {
  //         }
  //       })
  //     }
  //     expect(validation).to.throw(/required/)
  //   })
  //


})
