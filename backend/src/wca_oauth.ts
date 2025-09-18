import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"

const WCA_ORIGIN = process.env.WCA_ORIGIN || "https://www.worldcubeassociation.org"
const WCA_CLIENT_ID = process.env.WCA_CLIENT_ID as string
const WCA_CLIENT_SECRET = process.env.WCA_CLIENT_SECRET as string
const JWT_SECRET = process.env.JWT_SECRET || "supersecretjwt"

interface TokenResponse {
  access_token?: string
  error?: string
  [key: string]: any
}

interface WcaUserInfo {
  me?: {
    id: number
    name: string
    avatar?: {
      thumb_url?: string
    }
    delegate_status?: string | null
  }
}

export async function loginWithWca(req: Request, res: Response, _next: NextFunction) {
  try {
    const { code, redirectUri } = req.body
    if (!code || !redirectUri) {
      return res.status(400).json({ message: "Missing code or redirectUri" })
    }

    const tokenResponse = await fetch(`${WCA_ORIGIN}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        redirect_uri: redirectUri,
        client_id: WCA_CLIENT_ID,
        client_secret: WCA_CLIENT_SECRET,
        grant_type: "authorization_code",
      }),
    })

    const tokenData = (await tokenResponse.json()) as TokenResponse
    console.log(redirectUri, WCA_CLIENT_ID, WCA_CLIENT_SECRET, tokenData)
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({ message: "Error logging in with WCA", details: tokenData })
    }

    const userInfoResponse = await fetch(`${WCA_ORIGIN}/api/v0/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userInfo = (await userInfoResponse.json()) as WcaUserInfo

    if (!userInfo.me) {
      return res.status(500).json({ message: "Failed to fetch WCA user info" })
    }

    const payload = {
      wcaUserId: userInfo.me.id,
      username: userInfo.me.name,
      avatarUrl: userInfo.me.avatar?.thumb_url,
      roles: [] as string[],
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" })

    return res.status(200).json({
      token,
      userInfo: payload,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Unexpected error during WCA login" })
  }
}

export function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" })
  const token = authHeader.split(" ")[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    ;(req as any).user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" })
  }
}
