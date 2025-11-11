# Charging Points Synchronization Script

## Overview

The `fill_missed_charging_points.js` script automatically synchronizes charging points between cloud MQTT and ocpp-db ChargingPoints. It collects real-time connector count data from cloud MQTT, compares it with the database records, and creates any missing charging points.

## What It Does

1. **Connects to MQTT Broker**: Subscribes to charging station topics to collect connector count information
2. **Collects Device Data**: Listens for a specified duration to gather connector counts from all active charging stations
3. **Queries Database**: Retrieves existing charging stations and their charging points from MySQL
4. **Identifies Mismatches**: Compares actual connector counts with database records
5. **Creates Missing Points**: Automatically generates missing charging points for stations with incomplete data
6. **Reports Results**: Provides detailed logs of created points and stations not found in the database

## Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

   Or manually install specific packages:
   ```bash
   npm install mqtt dotenv sequelize mysql2
   ```

2. **Configure Environment Variables**:
   Create or edit the `.env` file from `.env.example` in the script directory


## How to Run

### Test Mode (Process Single Device)

1. Set `TEST_DEVICE_ID` in `.env` to the specific device ID you want to test
2. Run the script:
   ```bash
   node fill_missed_charging_points.js
   ```

### Normal Mode (Process All Devices)

1. Ensure `TEST_DEVICE_ID` is empty or removed from `.env`
2. Run the script:
   ```bash
   node fill_missed_charging_points.js
   ```


## How It Works

### 1. Device Collection Phase

The script subscribes to the MQTT topic pattern:
```
+/sweet-home/+/status-control/connectors-count
```

For the duration specified by `COLLECTOR_DURATION`, it collects messages containing connector counts from charging stations.

### 2. Data Processing Phase

- Deduplicates devices that sent multiple messages (keeps highest count)
- Connects to MySQL database
- Retrieves all charging stations and their existing charging points

### 3. Synchronization Phase

For each device found via MQTT:
- Searches for the corresponding station in the database (by `station_id`)
- Compares actual connector count with database records
- If mismatch detected:
  - Calculates the difference
  - Creates missing charging points with sequential `point_id` values
  - Generates unique IDs using timestamp + random number

### 4. Transaction Commit

- If all operations succeed: commits the transaction (saves all changes)
- If any error occurs: rolls back the transaction (no changes saved)

## Output Examples

### Stage 1: MQTT Connection & Subscription

```
Connected to MQTT broker
Subscribed to connectors-count
```

**What it means:**
- Successfully connected to the MQTT broker specified in `CLOUD_HOST`
- Subscribed to topic pattern `+/sweet-home/+/status-control/connectors-count`
- Ready to receive connector count messages from charging stations
- If you don't see this, check MQTT credentials and network connectivity

---

### Stage 2: Data Collection Phase

```
topic :>>  acc123/sweet-home/6r43-lnud-2u11-oa8z/status-control/connectors-count
message :>>  2
topic :>>  acc456/sweet-home/ab12-cd34-ef56-gh78/status-control/connectors-count
message :>>  4
topic :>>  acc123/sweet-home/6r43-lnud-2u11-oa8z/status-control/connectors-count
message :>>  3
```

**What it means:**
- Each line pair shows a message received from MQTT
- **topic**: The full MQTT topic path (format: `account/sweet-home/device-id/status-control/connectors-count`)
- **message**: The number of connectors for that charging station
- The device ID is extracted from position 3 in the topic (e.g., `6r43-lnud-2u11-oa8z`)
- Duplicate devices (like `6r43-lnud-2u11-oa8z` appearing twice) will be deduplicated, keeping the highest count
- This phase runs for the duration specified in `COLLECTOR_DURATION` (default 60 seconds)
- If no messages appear, check that charging stations are online and publishing to MQTT

---

### Stage 3: Collection Completed

```
Collection completed!
Disconnected from broker
pairs :>>  [
  [ '6r43-lnud-2u11-oa8z', 3 ],
  [ 'ab12-cd34-ef56-gh78', 4 ],
  [ '1234-5678-90ab-cdef', 2 ]
]
Deduplicated pairs :>>  [
  [ '6r43-lnud-2u11-oa8z', 3 ],
  [ 'ab12-cd34-ef56-gh78', 4 ],
  [ '1234-5678-90ab-cdef', 2 ]
]
```

**What it means:**
- MQTT collection timer has finished
- **pairs**: Raw device-connector pairs extracted from topics
- **Deduplicated pairs**: Final list after removing duplicates (highest count kept)
- Shows `[device_id, connector_count]` for each unique device
- This is the data that will be synchronized with the database

---

### Stage 4: Database Connection & Initial Query

```
Database connection established successfully
Found 150 charging stations
```

**What it means:**
- Successfully connected to MySQL database
- Retrieved all charging stations from the `charging_stations` table
- Number indicates total stations in the database (not just those found via MQTT)
- If connection fails, check database credentials and network access

---

### Stage 5: Device Processing

#### Test Mode Indicator
```
⚠️  TEST MODE: Only processing device: 6r43-lnud-2u11-oa8z
```
**What it means:**
- Script is running in test mode (TEST_DEVICE_ID is set)
- Only the specified device will have changes committed
- Other devices will be processed for analysis but changes will be skipped

#### Scenario A: Device Found, No Mismatch
```
Processing device: ab12-cd34-ef56-gh78, connector count: 4
Station found: Alpha Station (id: 12345), existing points: 4
```
**What it means:**
- Device `ab12-cd34-ef56-gh78` exists in database as station ID 12345
- Station name: "Alpha Station"
- Database already has 4 charging points (matches MQTT count of 4)
- ✅ No action needed - data is synchronized

#### Scenario B: Device Found, Mismatch Detected
```
Processing device: 6r43-lnud-2u11-oa8z, connector count: 3
Station found: Beta Station (id: 67890), existing points: 1
Mismatch! Expected 3, but found 1 points
newPoints :>>  [
  {
    id: 1731331234123456,
    name: 'Beta Station',
    point_id: 2,
    station_id: 67890,
    created: 2024-11-11T10:30:00.000Z,
    updated: 2024-11-11T10:30:00.000Z
  },
  {
    id: 1731331234987654,
    name: 'Beta Station',
    point_id: 3,
    station_id: 67890,
    created: 2024-11-11T10:30:00.000Z,
    updated: 2024-11-11T10:30:00.000Z
  }
]
✓ Prepared 2 new charging points
```
**What it means:**
- Device exists in database but has missing charging points
- **Expected**: 3 points (from MQTT), **Found**: 1 point (in database)
- **Mismatch**: 2 points need to be created
- **newPoints**: Array shows the charging points that will be created
  - `id`: Auto-generated unique ID (timestamp + random number)
  - `point_id`: Sequential connector number (2, 3 to complement existing point 1)
  - `station_id`: References the charging station
  - `name`: Inherits from the station name
- Changes are prepared in a transaction but not yet committed

#### Scenario C: Device Found, Test Mode Skip
```
Processing device: 1234-5678-90ab-cdef, connector count: 2
Station found: Gamma Station (id: 11111), existing points: 1
Mismatch! Expected 2, but found 1 points
⊘ Skipped (test mode)
```
**What it means:**
- Device has a mismatch but is NOT the TEST_DEVICE_ID
- Changes are identified but NOT applied (dry-run mode)
- Useful for previewing what would be created without making changes

#### Scenario D: Device Not Found in Database
```
Processing device: zzzz-yyyy-xxxx-wwww, connector count: 2
No station found for device: zzzz-yyyy-xxxx-wwww
```
**What it means:**
- Device publishes to MQTT but doesn't exist in the database
- Script tried to match both with and without dashes
- ⚠️ No action taken - device needs to be added to database manually
- Will be listed in "Stations Not Found" summary at the end

---

### Stage 6: Final Results

#### Success
```
=== Success ===
✓ Transaction committed successfully
Total charging points created: 5
Processed 3 unique devices
```
**What it means:**
- All database operations completed successfully
- Transaction was committed (all changes are now saved)
- **Total charging points created**: How many new points were added to the database
- **Processed**: Number of unique devices collected from MQTT

#### With Stations Not Found
```
=== Success ===
✓ Transaction committed successfully
Total charging points created: 5
Processed 10 unique devices

=== Stations Not Found by deviceId from cloud topic (3) ===
zzzz-yyyy-xxxx-wwww
aaaa-bbbb-cccc-dddd
test-device-id-999
```
**What it means:**
- Transaction successful for devices that were found
- Lists devices that exist in MQTT but NOT in the database
- These devices cannot be synchronized until added to the database
- Number in parentheses shows count of missing stations

#### Failure
```
=== Failed ===
✗ Transaction rolled back due to error: Duplicate entry '1234' for key 'PRIMARY'
No charging points were created
error :>>  [Full error stack trace]
```
**What it means:**
- An error occurred during database operations
- **Transaction rolled back**: ALL changes were reverted (nothing was saved)
- Database remains in its original state
- Error message provides details about what went wrong
- Common causes: database constraints, connection issues, permission problems

## Database Schema

The script works with two tables:

### charging_stations
- `id`: Primary key
- `station_id`: Unique station identifier
- `name`: Station name
- Other fields: status, vendor, model, coordinates, etc.

### charging_points
- `id`: Primary key (auto-generated)
- `point_id`: Connector number (1, 2, 3, etc.)
- `station_id`: Foreign key to charging_stations
- `name`: Point name (inherits from station)
- Other fields: status, coordinates, etc.

## Troubleshooting

### No Devices Collected
- Check MQTT broker connectivity
- Verify `CLOUD_HOST` and `CLOUD_CREDENTIALS` are correct
- Ensure charging stations are online and publishing to MQTT
- Increase `COLLECTOR_DURATION` if stations publish infrequently

### Database Connection Errors
- Verify MySQL credentials and host/port
- Check network connectivity to database
- Ensure database and tables exist

### Stations Not Found
If devices are listed under "Stations Not Found":
- The device exists in MQTT but not in the database
- Check if `station_id` format matches between MQTT and database
- Script attempts to match with and without dashes

### Transaction Rollback
If transaction fails:
- Check database constraints and permissions
- Review error message for specific issue
- All changes are rolled back automatically

## Recommendations

1. **First Run**: Use test mode with a known device to verify configuration
2. **Collector Duration**: Set long enough to capture all active devices (60 seconds recommended)
3. **Monitor**: Review logs to identify devices not found in database
