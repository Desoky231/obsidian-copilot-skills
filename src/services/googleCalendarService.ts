/* eslint-disable */
import { createServer, Server } from "http";
import { Notice } from "obsidian";
import { KeychainService } from "./keychainService";
import { logError, logInfo, logWarn } from "@/logger";
import { GOOGLE_CALENDAR_REDIRECT_URI, GOOGLE_CALENDAR_SCOPES } from "@/constants";
import { getSettings } from "@/settings/model";

const PORT = 4567;
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class GoogleCalendarService {
  private static instance: GoogleCalendarService | null = null;
  private server: Server | null = null;

  private constructor() {}

  static getInstance(): GoogleCalendarService {
    if (!GoogleCalendarService.instance) {
      GoogleCalendarService.instance = new GoogleCalendarService();
    }
    return GoogleCalendarService.instance;
  }

  /**
   * Stop the local loopback server
   */
  stopLocalServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logInfo("Google Calendar OAuth server stopped.");
    }
  }

  /**
   * Initiate the OAuth Login Flow
   */
  async initiateLogin(): Promise<void> {
    const { googleCalendarClientId, googleCalendarClientSecret } = getSettings();
    if (!googleCalendarClientId || !googleCalendarClientSecret) {
      new Notice(
        "Google Calendar Client ID or Secret is missing. Please configure them in Advanced Settings."
      );
      return;
    }

    // Start server to listen for the redirect
    this.startLocalServer();

    // Construct Auth URL
    const authUrl = new URL(OAUTH_AUTH_URL);
    authUrl.searchParams.append("client_id", googleCalendarClientId);
    authUrl.searchParams.append("redirect_uri", GOOGLE_CALENDAR_REDIRECT_URI);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("scope", GOOGLE_CALENDAR_SCOPES);
    authUrl.searchParams.append("access_type", "offline");
    authUrl.searchParams.append("prompt", "consent");

    // Open browser
    window.open(authUrl.toString());
  }

  /**
   * Start the local loopback server to receive the authorization code redirect.
   */
  private startLocalServer(): void {
    if (this.server) {
      this.stopLocalServer();
    }

    this.server = createServer(async (req, res) => {
      const reqUrl = req.url || "";
      if (reqUrl.startsWith("/callback")) {
        const urlObj = new URL(reqUrl, `http://${req.headers.host}`);
        const code = urlObj.searchParams.get("code");
        const error = urlObj.searchParams.get("error");

        if (error) {
          logError(`Google OAuth Error: ${error}`);
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            "<h1>Authentication Failed</h1><p>Check Obsidian logs for details. You can close this tab.</p>"
          );
          this.stopLocalServer();
          new Notice("Google Calendar Authentication Failed.");
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h1>Authentication Successful!</h1><p>You can close this tab and return to Obsidian.</p>"
          );
          await this.exchangeCodeForTokens(code);
          this.stopLocalServer();
          return;
        }

        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Invalid Request</h1>");
      }
    });

    this.server.on("error", (err: any) => {
      logError("Google Calendar local server error", err);
      new Notice("Google Calendar local server failed to start. Port 4567 might be in use.");
      this.stopLocalServer();
    });

    this.server.listen(PORT, "127.0.0.1", () => {
      logInfo(`Google Calendar OAuth server listening on http://127.0.0.1:${PORT}`);
    });
  }

  /**
   * Exchange the authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<void> {
    try {
      const response = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: getSettings().googleCalendarClientId,
          client_secret: getSettings().googleCalendarClientSecret,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      const data = await response.json();
      const accessToken = data.access_token;
      const refreshToken = data.refresh_token;

      if (accessToken) {
        const keychain = KeychainService.getInstance();
        keychain.setSecret("googleCalendarAccessToken", accessToken);
        if (refreshToken) {
          keychain.setSecret("googleCalendarRefreshToken", refreshToken);
        }
        new Notice("Google Calendar successfully connected! 🎉");
        logInfo("Google Calendar tokens saved to Keychain.");
      }
    } catch (error) {
      logError("Error exchanging Google Calendar code for tokens", error);
      new Notice("Failed to connect Google Calendar. Check logs.");
    }
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  private async getValidAccessToken(): Promise<string | null> {
    const keychain = KeychainService.getInstance();
    const accessToken = keychain.getSecret("googleCalendarAccessToken");

    if (!accessToken) return null;

    // Fast check: Try a tiny fetch to see if it's still valid
    const checkResponse = await fetch(`${CALENDAR_API_URL}?maxResults=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (checkResponse.ok) {
      return accessToken;
    } else if (checkResponse.status === 401) {
      // Token expired, need to refresh
      const refreshToken = keychain.getSecret("googleCalendarRefreshToken");
      if (!refreshToken) {
        logWarn("Google Calendar access token expired and no refresh token available.");
        return null;
      }

      try {
        logInfo("Refreshing Google Calendar access token...");
        const refreshResponse = await fetch(OAUTH_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: getSettings().googleCalendarClientId,
            client_secret: getSettings().googleCalendarClientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
        });

        if (!refreshResponse.ok) {
          throw new Error("Refresh failed");
        }

        const data = await refreshResponse.json();
        const newAccessToken = data.access_token;
        keychain.setSecret("googleCalendarAccessToken", newAccessToken);
        return newAccessToken;
      } catch (err) {
        logError("Failed to refresh Google Calendar token", err);
        return null;
      }
    }

    return null;
  }

  /**
   * Fetch recent and upcoming events from the user's primary calendar
   * Returns a highly token-efficient XML string for the LLM.
   * Default range: 30 days in the past to 60 days in the future.
   */
  async fetchCalendarEventsAsXML(): Promise<string> {
    const token = await this.getValidAccessToken();
    if (!token) {
      return '<existing_calendar_events error="Not connected to Google Calendar" />';
    }

    try {
      // Determine date range (30 days ago to 60 days ahead)
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60, 23, 59, 59);

      const url = new URL(CALENDAR_API_URL);
      url.searchParams.append("timeMin", startDate.toISOString());
      url.searchParams.append("timeMax", endDate.toISOString());
      url.searchParams.append("singleEvents", "true");
      url.searchParams.append("orderBy", "startTime");

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.statusText}`);
      }

      const data = await response.json();
      const events = data.items || [];

      // Format as compact XML
      let xml = `<existing_calendar_events range_start="${startDate.toISOString().split("T")[0]}" range_end="${endDate.toISOString().split("T")[0]}">\n`;

      for (const event of events) {
        // Skip declined events
        const isDeclined = event.attendees?.some(
          (a: any) => a.self && a.responseStatus === "declined"
        );
        if (isDeclined) continue;

        const summary = event.summary || "Busy";
        const start = event.start.dateTime || event.start.date;
        const end = event.end.dateTime || event.end.date;

        xml += `  <event>\n`;
        xml += `    <summary>${summary}</summary>\n`;
        xml += `    <start>${start}</start>\n`;
        xml += `    <end>${end}</end>\n`;
        xml += `  </event>\n`;
      }

      xml += `</existing_calendar_events>`;
      return xml;
    } catch (error) {
      logError("Google Calendar fetch error", error);
      return '<existing_calendar_events error="Failed to fetch events" />';
    }
  }

  /**
   * Delete all events on a specific calendar day.
   * Used before re-creating a fresh full-day schedule.
   * @param date - YYYY-MM-DD string
   */
  async clearEventsForDay(date: string): Promise<void> {
    const token = await this.getValidAccessToken();
    if (!token) return;

    // Build a full-day range in local time
    const dayStart = new Date(`${date}T00:00:00`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59`).toISOString();

    const url = new URL(CALENDAR_API_URL);
    url.searchParams.append("timeMin", dayStart);
    url.searchParams.append("timeMax", dayEnd);
    url.searchParams.append("singleEvents", "true");

    const listRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!listRes.ok) {
      logError(`Failed to list events for day ${date}: ${listRes.statusText}`);
      return;
    }

    const data = await listRes.json();
    const events: Array<{ id: string }> = data.items || [];

    await Promise.all(
      events.map((ev) =>
        fetch(`${CALENDAR_API_URL}/${ev.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).catch((err) => logError(`Failed to delete event ${ev.id}`, err))
      )
    );
  }

  /**
   * Replace the entire schedule for a day: clears all existing events then
   * creates the new full set. Returns true if at least one event was created.
   */
  async createEvents(
    events: Array<{ summary: string; start: string; end: string }>,
    date?: string
  ): Promise<boolean> {
    const token = await this.getValidAccessToken();
    if (!token) {
      new Notice("Not connected to Google Calendar.");
      return false;
    }

    // Clear the whole day first so we never duplicate
    if (date) {
      await this.clearEventsForDay(date);
    }

    /**
     * Ensure a datetime string is RFC 3339 with timezone info.
     * Bare datetimes (no Z / offset) are parsed as local time.
     */
    const normalizeDateTime = (dt: string): string => {
      if (/Z$|[+-]\d{2}:\d{2}$/.test(dt)) return dt;
      const d = new Date(dt);
      if (!isNaN(d.getTime())) return d.toISOString();
      return dt;
    };

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      let successCount = 0;
      for (const event of events) {
        const startDateTime = normalizeDateTime(event.start);
        const endDateTime = normalizeDateTime(event.end);

        const response = await fetch(CALENDAR_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: event.summary,
            start: { dateTime: startDateTime, timeZone },
            end: { dateTime: endDateTime, timeZone },
          }),
        });

        if (response.ok) {
          successCount++;
        } else {
          const errBody = await response.text().catch(() => response.statusText);
          logError(`Failed to create event "${event.summary}": ${errBody}`);
        }
      }

      if (successCount > 0) {
        new Notice(`✅ Synced ${successCount} event(s) to Google Calendar!`);
        return true;
      }
      return false;
    } catch (error) {
      logError("Google Calendar create error", error);
      new Notice("Failed to create events in Google Calendar.");
      return false;
    }
  }
}
