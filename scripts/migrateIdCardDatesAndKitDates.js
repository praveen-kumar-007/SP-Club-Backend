require("dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();
const mongoose = require("mongoose");

async function migrate() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI is missing in .env");
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB successfully.");

    const collection = mongoose.connection.db.collection("registrations");

    // 1. Update ID card generated dates to match registration date
    const idCardHolders = await collection
      .find({ idCardNumber: { $ne: null } })
      .toArray();

    console.log(`\nFound ${idCardHolders.length} players with ID Card Numbers.`);
    for (const player of idCardHolders) {
      const regDate = player.registeredAt || player._id.getTimestamp();
      await collection.updateOne(
        { _id: player._id },
        {
          $set: {
            idCardGeneratedAt: regDate,
          },
        }
      );
      console.log(
        `✓ Updated ID Card Date for "${player.name}" (${player.idCardNumber}): Previous: ${player.idCardGeneratedAt ? new Date(player.idCardGeneratedAt).toISOString() : "null"} -> New: ${new Date(regDate).toISOString()}`
      );
    }

    // 2. Update kitSizeSelectedAt for all players who chose kitSize
    const kitHolders = await collection
      .find({ kitSize: { $ne: null, $nin: ["", null] } })
      .toArray();

    console.log(`\nFound ${kitHolders.length} players with Kit Size chosen.`);
    for (const player of kitHolders) {
      const selectedDate =
        player.kitSizeSelectedAt || player.registeredAt || player._id.getTimestamp();
      await collection.updateOne(
        { _id: player._id },
        {
          $set: {
            kitSizeSelectedAt: selectedDate,
          },
        }
      );
      console.log(
        `✓ Set Kit Size Date for "${player.name}" (Size: ${player.kitSize}): ${new Date(selectedDate).toISOString()}`
      );
    }

    // 3. Update jerseyAssignedAt for all players who have jerseyNumber
    const jerseyHolders = await collection
      .find({ jerseyNumber: { $ne: null } })
      .toArray();

    console.log(`\nFound ${jerseyHolders.length} players with Jersey assigned.`);
    for (const player of jerseyHolders) {
      const assignedDate =
        player.jerseyAssignedAt || player.registeredAt || player._id.getTimestamp();
      await collection.updateOne(
        { _id: player._id },
        {
          $set: {
            jerseyAssignedAt: assignedDate,
          },
        }
      );
      console.log(
        `✓ Set Jersey Assigned Date for "${player.name}" (Jersey: #${player.jerseyNumber}): ${new Date(assignedDate).toISOString()}`
      );
    }

    console.log("\n🎉 Database migration completed successfully!");
    await mongoose.disconnect();
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
