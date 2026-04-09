const jwt = require("jsonwebtoken");
const Registration = require("../models/registration");

const PLAYER_JWT_SECRET =
  process.env.PLAYER_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "sp_club_player_secret_key_2024";

const playerAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res
        .status(401)
        .json({ message: "Player authentication is required" });
    }

    const decoded = jwt.verify(token, PLAYER_JWT_SECRET);

    if (!decoded?.id) {
      return res.status(401).json({ message: "Invalid player token" });
    }

    const player = await Registration.findById(decoded.id).select(
      "_id name email role status idCardNumber attendance",
    );

    if (!player) {
      return res.status(401).json({ message: "Player not found" });
    }

    if (player.status !== "approved") {
      return res
        .status(403)
        .json({ message: "Player account is not eligible for login" });
    }

    req.playerId = player._id;
    req.player = player;

    next();
  } catch (error) {
    return res.status(401).json({ message: "Player authentication failed" });
  }
};

module.exports = { playerAuth };
