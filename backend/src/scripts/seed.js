// Run once to seed the first company + admin user.
// Usage: node src/scripts/seed.js
require('dotenv').config();
const bcrypt    = require('bcrypt');
const sequelize = require('../config/database');
const { User, Company } = require('../models');

const COMP_ID    = 'ADS';
const BRANCH_ID  = 'HO';
const USER_CODE  = 'ADMIN';
const PASSWORD   = 'Admin@1234';
const FULL_NAME  = 'Administrator';

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('DB connected');

    // Company
    const [comp, compCreated] = await Company.findOrCreate({
      where: { pkCompID: COMP_ID },
      defaults: {
        CompName:  'ADITYA SERVICES',
        CompAlias: 'ADS',
        Active:    'Y',
        fkUserID:  'SYSTEM',
        CrMod:     new Date(),
      },
    });
    console.log(compCreated ? 'Company created: ADS' : 'Company ADS already exists');

    // Admin user
    const existing = await User.findOne({ where: { fkCompID: COMP_ID, UserCode: USER_CODE } });
    if (existing) {
      console.log(`User ${USER_CODE} already exists — skipping`);
    } else {
      const hash = await bcrypt.hash(PASSWORD, 12);
      await User.create({
        pkUserId:     `${COMP_ID}_${USER_CODE}_001`,
        fkCompID:     COMP_ID,
        fkBranchID:   BRANCH_ID,
        UserCode:     USER_CODE,
        UserFullName: FULL_NAME,
        UserPassword: hash,
        Active:       'Y',
        CrMod:        new Date(),
      });
      console.log(`User created: ${USER_CODE} / password: ${PASSWORD}`);
    }
  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await sequelize.close();
  }
}

seed();
