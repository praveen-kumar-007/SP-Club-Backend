const Registration = require("../models/registration");
const {
  sendPendingVerificationReminderMail,
  sendApplicationRejectedMail,
} = require("./brevoMailer");

/**
 * Processes all pending registrations:
 * 1. If registered >= 30 days ago:
 *    - Auto-rejects candidate
 *    - Sets status = "rejected", autoRejected = true, records rejectedAt and rejectionReason
 *    - Sends formal rejection email mentioning non-attendance within 30 days and visiting the academy office for further communications.
 * 2. If registered >= 3 days ago and < 30 days:
 *    - Checks if at least 3 days have elapsed since registration AND since the last verification reminder email was sent.
 *    - Dispatches formal reminder email with applicant details, original documents checklist, 30-day warning, and visiting requirements.
 *    - Updates verificationReminders tracking (lastSentAt, count, history).
 */
const processPendingRegistrations = async () => {
  const now = new Date();
  const summary = {
    processedAt: now,
    totalPending: 0,
    remindersSent: 0,
    autoRejected: 0,
    errors: [],
  };

  try {
    const pendingRegistrations = await Registration.find({ status: "pending" });
    summary.totalPending = pendingRegistrations.length;

    for (const reg of pendingRegistrations) {
      try {
        const registeredAt = reg.registeredAt
          ? new Date(reg.registeredAt)
          : new Date(reg._id.getTimestamp());
        const diffMs = now.getTime() - registeredAt.getTime();
        const daysElapsed = Math.max(
          0,
          Math.floor(diffMs / (1000 * 60 * 60 * 24)),
        );

        // Case A: 30 days or more elapsed -> Auto-reject
        if (daysElapsed >= 30) {
          console.log(
            `[Auto-Rejection] Candidate ${reg.name} (${reg._id}) registered ${daysElapsed} days ago. Auto-rejecting...`,
          );

          reg.status = "rejected";
          reg.rejectedAt = now;
          reg.rejectionReason = `Application automatically rejected by system: In-person document verification was not completed within the mandatory 30-day window (registered ${daysElapsed} days ago).`;
          reg.autoRejected = true;
          reg.autoRejectionMailSentAt = now;
          await reg.save();

          await sendApplicationRejectedMail(reg, reg.rejectionReason).catch(
            (mailErr) => {
              console.error(
                `Failed to send auto-rejection mail to ${reg.email}:`,
                mailErr?.message || mailErr,
              );
            },
          );

          summary.autoRejected++;
          continue;
        }

        // Case B: 3 days or more elapsed -> Send 3-day reminder if gap is >= 3 days
        if (daysElapsed >= 3) {
          const lastSent = reg.verificationReminders?.lastSentAt
            ? new Date(reg.verificationReminders.lastSentAt)
            : null;

          let shouldSendReminder = false;

          if (!lastSent) {
            // Never received a reminder yet and registration is >= 3 days old
            shouldSendReminder = true;
          } else {
            const daysSinceLastSent = Math.floor(
              (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24),
            );
            if (daysSinceLastSent >= 3) {
              shouldSendReminder = true;
            }
          }

          if (shouldSendReminder) {
            const nextCount = (reg.verificationReminders?.count || 0) + 1;
            const daysRemaining = Math.max(0, 30 - daysElapsed);

            console.log(
              `[Pending-Reminder] Sending 3-day verification reminder #${nextCount} to ${reg.name} (${reg._id}) [Day ${daysElapsed}/30]...`,
            );

            if (!reg.verificationReminders) {
              reg.verificationReminders = {
                count: 0,
                lastSentAt: null,
                history: [],
              };
            }
            reg.verificationReminders.lastSentAt = now;
            reg.verificationReminders.count = nextCount;
            if (!Array.isArray(reg.verificationReminders.history)) {
              reg.verificationReminders.history = [];
            }
            reg.verificationReminders.history.push({
              sentAt: now,
              dayNumber: daysElapsed,
              reminderIndex: nextCount,
            });

            await reg.save();

            await sendPendingVerificationReminderMail(reg, {
              daysElapsed,
              daysRemaining,
              reminderCount: nextCount,
            }).catch((mailErr) => {
              console.error(
                `Failed to send reminder mail to ${reg.email}:`,
                mailErr?.message || mailErr,
              );
            });

            summary.remindersSent++;
          }
        }
      } catch (playerError) {
        console.error(
          `Error processing pending player ${reg._id} (${reg.name}):`,
          playerError,
        );
        summary.errors.push({
          playerId: reg._id,
          name: reg.name,
          error: playerError.message || String(playerError),
        });
      }
    }

    console.log(
      `[Verification Service] Execution complete: ${summary.remindersSent} reminders sent, ${summary.autoRejected} auto-rejected, ${summary.errors.length} errors.`,
    );
    return summary;
  } catch (err) {
    console.error("Fatal error in processPendingRegistrations:", err);
    summary.fatalError = err.message || String(err);
    return summary;
  }
};

module.exports = {
  processPendingRegistrations,
};
