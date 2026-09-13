const Registration = require("../models/registration");
const { sendBirthdayFollowupMail } = require("./brevoMailer");

/**
 * Returns { day, month, year } in Asia/Kolkata (Indian Standard Time - IST)
 */
const getISTDateParts = (dateInput = new Date()) => {
  if (!dateInput) return { day: null, month: null, year: null };
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return { day: null, month: null, year: null };

  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  const parts = formatter.formatToParts(d);
  return {
    day: Number(parts.find((p) => p.type === "day")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    year: Number(parts.find((p) => p.type === "year")?.value),
  };
};

/**
 * Checks if a player's DOB matches targetDate in Indian Standard Time (IST)
 */
const isPlayerBirthdayInIST = (playerDob, targetDate = new Date()) => {
  if (!playerDob) return false;
  const istToday = getISTDateParts(targetDate);
  const istDob = getISTDateParts(playerDob);

  return (
    istToday.day !== null &&
    istDob.day !== null &&
    istToday.day === istDob.day &&
    istToday.month === istDob.month
  );
};

/**
 * Finds all players whose birthday falls on the given date in IST (default: today IST).
 * Uses timezone: "Asia/Kolkata" in MongoDB aggregation, with secondary IST verification in JS.
 */
const findBirthdayPlayersInIST = async (targetDate = new Date()) => {
  const { day: istDay, month: istMonth } = getISTDateParts(targetDate);

  let candidates = [];
  try {
    candidates = await Registration.aggregate([
      {
        $match: {
          dob: { $exists: true, $ne: null },
          status: { $ne: "rejected" },
          $expr: {
            $and: [
              {
                $eq: [
                  {
                    $month: {
                      date: { $toDate: "$dob" },
                      timezone: "Asia/Kolkata",
                    },
                  },
                  istMonth,
                ],
              },
              {
                $eq: [
                  {
                    $dayOfMonth: {
                      date: { $toDate: "$dob" },
                      timezone: "Asia/Kolkata",
                    },
                  },
                  istDay,
                ],
              },
            ],
          },
        },
      },
    ]);
  } catch (aggErr) {
    console.warn(
      "[Birthday-Service] MongoDB aggregation with timezone failed, falling back to JS filter:",
      aggErr.message,
    );
    const allCandidates = await Registration.find({
      dob: { $exists: true, $ne: null },
      status: { $ne: "rejected" },
    }).lean();
    candidates = allCandidates;
  }

  // Strict secondary IST filter to guarantee 100% accuracy in Asia/Kolkata
  return candidates.filter((p) => isPlayerBirthdayInIST(p.dob, targetDate));
};

/**
 * Checks and sends birthday follow-up emails for players having their birthday in IST
 */
const checkAndSendBirthdayFollowups = async (targetDate = new Date(), options = {}) => {
  const istInfo = getISTDateParts(targetDate);
  console.log(
    `[Birthday-Cron] Checking for player birthdays on IST Date: ${istInfo.day}/${istInfo.month}/${istInfo.year}...`,
  );

  const birthdayPlayers = await findBirthdayPlayersInIST(targetDate);

  if (birthdayPlayers && birthdayPlayers.length > 0) {
    console.log(
      `[Birthday-Cron] Found ${birthdayPlayers.length} player(s) with birthday today in IST (${istInfo.day}/${istInfo.month}). Sending alert...`,
    );
    const result = await sendBirthdayFollowupMail(birthdayPlayers, options);
    return {
      sent: true,
      count: birthdayPlayers.length,
      players: birthdayPlayers.map((p) => ({
        id: p._id,
        name: p.name,
        dob: p.dob,
        email: p.email,
        phone: p.phone,
      })),
      result,
    };
  }

  console.log(
    `[Birthday-Cron] No birthdays today in IST (${istInfo.day}/${istInfo.month}).`,
  );
  return {
    sent: false,
    count: 0,
    players: [],
    message: `No birthdays found for IST date ${istInfo.day}/${istInfo.month}/${istInfo.year}`,
  };
};

module.exports = {
  getISTDateParts,
  isPlayerBirthdayInIST,
  findBirthdayPlayersInIST,
  checkAndSendBirthdayFollowups,
};
