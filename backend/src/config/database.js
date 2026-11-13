const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    dialect: 'mysql',
    dialectOptions: process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {},
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: false,
      freezeTableName: true,
    },
  }
);

sequelize.addHook('afterConnect', (connection) =>
  new Promise((resolve, reject) =>
    connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) =>
      err ? reject(err) : resolve()
    )
  )
);

module.exports = sequelize;
