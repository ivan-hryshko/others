const mqtt = require('mqtt');
require('dotenv').config();
const { Sequelize, DataTypes, Op } = require('sequelize');

const {
    CLOUD_HOST,
    CLOUD_CREDENTIALS,
    COLLECTOR_DURATION,
    OCPP_MYSQL_HOST,
    OCPP_MYSQL_PORT,
    OCPP_MYSQL_DATABASE,
    OCPP_MYSQL_USER,
    OCPP_MYSQL_PASSWORD,
    TEST_DEVICE_ID,
} = process.env

class DeviceCollector {
    constructor(brokerUrl = 'mqtt://localhost:1883', options = {}) {
        this.brokerUrl = brokerUrl;
        this.client = mqtt.connect(brokerUrl, options);
        this.devicesConnectorCount = new Map();

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('connect', () => {
            console.log('Connected to MQTT broker');
            this.client.subscribe('+/sweet-home/+/status-control/connectors-count', { qos: 1 });
            console.log('Subscribed to connectors-coun');
        });
    }

    handleMessage(topic, payload) {
        const message = payload.toString()
        console.log('topic :>> ', topic);
        console.log('message :>> ', message);
        this.devicesConnectorCount.set(topic, Number(message))
    }

    handleCollect() {
        return new Promise((resolve) => {
            this.client.on('message', this.handleMessage.bind(this));
    
            
            this.client.on('error', (error) => {
                console.error('MQTT client error:', error);
                process.exit(0);
            });
    
            setTimeout(() => {
                console.log('Collection completed!');
                this.client.off('message', this.handleMessage.bind(this));
                this.disconnect();
                resolve()
            }, COLLECTOR_DURATION || 60000);
        })
    }

    disconnect() {
        this.client.end();
        console.log('Disconnected from broker');
    }

    getDevaceConnectorPairs() {
        const pairs = Array.from(this.devicesConnectorCount.entries())
            .map(([topic, count]) => {
                const parts = topic.split('/')
                const deviceId = parts[2]
                return [deviceId, count]
            })
        return pairs
    }
}

class DatabaseManager {
    constructor(config) {
        this.sequelize = new Sequelize(
            config.database,
            config.username,
            config.password,
            {
                host: config.host,
                port: config.port || 3306,
                dialect: 'mysql',
                logging: false,
                pool: {
                    max: 5,
                    min: 0,
                    acquire: 30000,
                    idle: 10000
                }
            }
        );

        this.initModels();
    }

    initModels() {
        // ChargingStation model
        this.ChargingStation = this.sequelize.define('ChargingStation', {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false
            },
            station_id: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true
            },
            status: {
                type: DataTypes.STRING
            },
            read_only: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            last_heartbeat: {
                type: DataTypes.DATE
            },
            longitude: {
                type: DataTypes.STRING
            },
            latitude: {
                type: DataTypes.STRING
            },
            vendor: {
                type: DataTypes.STRING
            },
            model: {
                type: DataTypes.STRING
            },
            mqtt_token: {
                type: DataTypes.STRING
            },
            list_version: {
                type: DataTypes.INTEGER.UNSIGNED
            },
            ocpp_status: {
                type: DataTypes.STRING,
                defaultValue: 'Available'
            },
            created: {
                type: DataTypes.DATE
            },
            updated: {
                type: DataTypes.DATE
            },
            deleted: {
                type: DataTypes.DATE
            }
        }, {
            tableName: 'charging_stations',
            timestamps: false,
            paranoid: false
        });

        // ChargingPoint model
        this.ChargingPoint = this.sequelize.define('ChargingPoint', {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false
            },
            point_id: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false
            },
            station_id: {
                type: DataTypes.STRING,
                allowNull: false
            },
            latitude: {
                type: DataTypes.STRING
            },
            longitude: {
                type: DataTypes.STRING
            },
            error_code: {
                type: DataTypes.STRING
            },
            connector_status: {
                type: DataTypes.STRING
            },
            created: {
                type: DataTypes.DATE
            },
            updated: {
                type: DataTypes.DATE
            },
            deleted: {
                type: DataTypes.DATE
            }
        }, {
            tableName: 'charging_points',
            timestamps: false,
            paranoid: false
        });

        // Define associations
        this.ChargingStation.hasMany(this.ChargingPoint, {
            foreignKey: 'station_id',
            sourceKey: 'station_id',
            as: 'charging_points'
        });

        this.ChargingPoint.belongsTo(this.ChargingStation, {
            foreignKey: 'station_id',
            targetKey: 'station_id',
            as: 'charging_station'
        });
    }

    async connect() {
        try {
            await this.sequelize.authenticate();
            console.log('Database connection established successfully');
        } catch (error) {
            console.error('Unable to connect to database:', error);
            throw error;
        }
    }

    async findAllChargingStations(options = {}) {
        try {
            const stations = await this.ChargingStation.findAll({
                include: options.includePoints ? [{
                    model: this.ChargingPoint,
                    as: 'charging_points',
                    where: { deleted: null },
                    required: false
                }] : [],
                where: { deleted: null },
                ...options
            });
            return stations;
        } catch (error) {
            console.error('Error fetching charging stations:', error);
            throw error;
        }
    }

    async findChargingStationByStationId(stationId) {
        try {
            // Remove dashes for normalized comparison
            const normalizedId = stationId.replace(/-/g, '');

            // Try to find by exact match first, or by normalized version (without dashes)
            const station = await this.ChargingStation.findOne({
                where: {
                    [Op.or]: [
                        { station_id: stationId },
                        { station_id: normalizedId }
                    ],
                    deleted: null
                }
            });
            return station;
        } catch (error) {
            console.error(`Error fetching charging station for station_id ${stationId}:`, error);
            throw error;
        }
    }

    async findChargingPointsByStationId(stationId) {
        try {
            const points = await this.ChargingPoint.findAll({
                where: {
                    station_id: stationId,
                    deleted: null
                }
            });
            return points;
        } catch (error) {
            console.error(`Error fetching charging points for station_id ${stationId}:`, error);
            throw error;
        }
    }

    getRandomInt(min, max) {
        const minBorder = Math.ceil(min);
        const maxBorder = Math.floor(max);

        return Math.floor(Math.random() * (maxBorder - minBorder)) + minBorder;
    }

    generateId() {
        const timestamp = `${Date.now()}`.slice(0, -3);
        return +`${timestamp}${this.getRandomInt(100000, 999999)}`;
    }

    async createChargingPoints(station, newCount, oldCount, transaction) {
        try {
            const diff = newCount - oldCount;
            const newPointsIds = Array.from({ length: diff }, (_, i) => oldCount + i + 1);

            const now = new Date();
            const newPoints = newPointsIds.map(point_id => ({
                id: this.generateId(),
                name: station.name,
                point_id: point_id,
                station_id: station.id,
                created: now,
                updated: now
            }));

            console.log('newPoints :>> ', newPoints);
            await this.ChargingPoint.bulkCreate(newPoints, { transaction });

            return newPoints;
        } catch (error) {
            console.error(`Error creating charging points for station ${station.id}:`, error);
            throw error;
        }
    }

    async disconnect() {
        await this.sequelize.close();
        console.log('Database connection closed');
    }
}

class ChargingPointsSynchronizer {
    constructor(config) {
        this.brokerUrl = config.brokerUrl;
        this.brokerOptions = config.brokerOptions;
        this.dbConfig = config.dbConfig;
        this.testDeviceId = config.testDeviceId;
        this.dbManager = null;
    }

    deduplicatePairs(pairs) {
        const deviceMap = new Map();
        for (const [deviceId, connectorCount] of pairs) {
            const existingCount = deviceMap.get(deviceId) || 0;
            if (connectorCount > existingCount) {
                deviceMap.set(deviceId, connectorCount);
            }
        }
        return Array.from(deviceMap.entries());
    }

    async collectDeviceData() {
        const collector = new DeviceCollector(this.brokerUrl, this.brokerOptions);
        await collector.handleCollect();
        const pairs = collector.getDevaceConnectorPairs();
        console.log('pairs :>> ', pairs);

        const deduplicatedPairs = this.deduplicatePairs(pairs);
        console.log('Deduplicated pairs :>> ', deduplicatedPairs);

        return deduplicatedPairs;
    }

    async connectDatabase() {
        this.dbManager = new DatabaseManager(this.dbConfig);
        await this.dbManager.connect();
    }

    async processDevices(deduplicatedPairs) {
        const chargingStations = await this.dbManager.findAllChargingStations({ includePoints: true });
        console.log(`Found ${chargingStations.length} charging stations`);

        if (this.testDeviceId) {
            console.log(`\n⚠️  TEST MODE: Only processing device: ${this.testDeviceId}`);
        }

        const transaction = await this.dbManager.sequelize.transaction();
        let createdCount = 0;
        const notFoundDevices = [];

        try {
            for (const [deviceId, connectorCount] of deduplicatedPairs) {
                console.log(`\nProcessing device: ${deviceId}, connector count: ${connectorCount}`);

                const station = await this.dbManager.findChargingStationByStationId(deviceId);

                if (station) {
                    const chargingPoints = await this.dbManager.findChargingPointsByStationId(station.id);
                    console.log(`Station found: ${station.name} (id: ${station.id}), existing points: ${chargingPoints.length}`);

                    if (chargingPoints.length !== connectorCount) {
                        console.log(`Mismatch! Expected ${connectorCount}, but found ${chargingPoints.length} points`);

                        if (!this.testDeviceId || this.testDeviceId === deviceId) {
                            const newPoints = await this.dbManager.createChargingPoints(
                                station,
                                connectorCount,
                                chargingPoints.length,
                                transaction
                            );

                            console.log(`✓ Prepared ${newPoints.length} new charging points`);
                            createdCount += newPoints.length;
                        } else {
                            console.log(`⊘ Skipped (test mode)`);
                        }
                    }
                } else {
                    console.log(`No station found for device: ${deviceId}`);
                    notFoundDevices.push(deviceId);
                }
            }

            await transaction.commit();
            console.log(`\n=== Success ===`);
            console.log(`✓ Transaction committed successfully`);
            console.log(`Total charging points created: ${createdCount}`);
            console.log(`Processed ${deduplicatedPairs.length} unique devices`);

            if (notFoundDevices.length > 0) {
                console.log(`\n=== Stations Not Found by deviceId from cloud topic (${notFoundDevices.length}) ===`);
                notFoundDevices.forEach(deviceId => console.log(deviceId));
            }

        } catch (error) {
            await transaction.rollback();
            console.error(`\n=== Failed ===`);
            console.error(`✗ Transaction rolled back due to error: ${error.message}`);
            console.error(`No charging points were created`);
            throw error;
        }
    }

    async run() {
        try {
            const deduplicatedPairs = await this.collectDeviceData();
            await this.connectDatabase();
            await this.processDevices(deduplicatedPairs);
        } catch (error) {
            console.log('error :>> ', error);
        } finally {
            if (this.dbManager) {
                await this.dbManager.disconnect();
            }
            process.exit(0);
        }
    }
}

async function start() {
    const synchronizer = new ChargingPointsSynchronizer({
        brokerUrl: CLOUD_HOST,
        brokerOptions: JSON.parse(CLOUD_CREDENTIALS),
        dbConfig: {
            host: OCPP_MYSQL_HOST,
            port: OCPP_MYSQL_PORT,
            database: OCPP_MYSQL_DATABASE,
            username: OCPP_MYSQL_USER,
            password: OCPP_MYSQL_PASSWORD
        },
        testDeviceId: TEST_DEVICE_ID
    });

    await synchronizer.run();
}

start()