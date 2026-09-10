const Registration = require("../models/registration");

/**
 * Idempotently ensures that:
 * 1. ID card generation dates match registration date in DB.
 * 2. Kit size selection dates are populated.
 * 3. Jersey assignment dates are populated.
 */
async function syncRegistrationDates() {
  try {
    const misalignedIdCards = await Registration.find({
      idCardNumber: { $ne: null },
    }).select("_id registeredAt idCardGeneratedAt name");

    for (const doc of misalignedIdCards) {
      const regTime = doc.registeredAt
        ? new Date(doc.registeredAt).getTime()
        : doc._id.getTimestamp().getTime();
      const idGenTime = doc.idCardGeneratedAt
        ? new Date(doc.idCardGeneratedAt).getTime()
        : null;

      if (!idGenTime || Math.abs(idGenTime - regTime) > 60000) {
        doc.idCardGeneratedAt = doc.registeredAt || doc._id.getTimestamp();
        await doc.save();
      }
    }

    // Set kitSizeSelectedAt if kitSize is selected but date is missing
    await Registration.updateMany(
      {
        kitSize: { $ne: null, $nin: ["", null] },
        kitSizeSelectedAt: null,
      },
      [
        {
          $set: {
            kitSizeSelectedAt: {
              $ifNull: ["$registeredAt", "$$NOW"],
            },
          },
        },
      ]
    );

    // Set jerseyAssignedAt if jerseyNumber is assigned but date is missing
    await Registration.updateMany(
      {
        jerseyNumber: { $ne: null },
        jerseyAssignedAt: null,
      },
      [
        {
          $set: {
            jerseyAssignedAt: {
              $ifNull: ["$registeredAt", "$$NOW"],
            },
          },
        },
      ]
    );
  } catch (error) {
    console.error("⚠️ Background registration date sync error:", error.message);
  }
}

module.exports = { syncRegistrationDates };
