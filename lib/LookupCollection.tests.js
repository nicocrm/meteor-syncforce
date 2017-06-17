import LookupCollection from './LookupCollection'
import {expect} from 'meteor/practicalmeteor:chai'

describe('LookupCollection', () => {
  it('places lookups with a related list name at the end', () => {
    const lc = new LookupCollection({}, 'TestEntity', [{
      relatedListName: 'foo'
    }, {
      
    }])
    expect(lc.lookups[0].relatedListName).to.not.be.ok
    expect(lc.lookups[1].relatedListName).to.equal('foo')
  })
})