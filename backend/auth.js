import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";


// =====================================
// JWT SECRET
// =====================================

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "JUSTBRAND_SECRET_2026_CHANGE_LATER";


// =====================================
// HASH PASSWORD
// =====================================

export async function hashPassword(password) {

  return await bcrypt.hash(
    password,
    12
  );

}


// =====================================
// COMPARE PASSWORD
// =====================================

export async function comparePassword(
  password,
  passwordHash
) {

  return await bcrypt.compare(
    password,
    passwordHash
  );

}


// =====================================
// CREATE TOKEN
// =====================================

export function createToken(payload) {

  return jwt.sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: "8h"
    }
  );

}


// =====================================
// REQUIRE AUTH
// =====================================

export function requireAuth(
  req,
  res,
  next
) {

  try {

    const authHeader =
      req.headers.authorization || "";


    if (!authHeader.startsWith("Bearer ")) {

      return res.status(401).json({
        success: false,
        message: "Authentication token required."
      });

    }


    const token =
      authHeader.substring(7);


    if (!token) {

      return res.status(401).json({
        success: false,
        message: "Authentication token required."
      });

    }


    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );


    req.user = decoded;

    next();

  } catch (error) {

    console.error(
      "AUTH ERROR:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });

  }

}


// =====================================
// REQUIRE ROLE
// =====================================

export function requireRole(
  ...allowedRoles
) {

  return (
    req,
    res,
    next
  ) => {

    if (!req.user) {

      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });

    }


    if (
      !allowedRoles.includes(
        req.user.role
      )
    ) {

      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action."
      });

    }


    next();

  };

}