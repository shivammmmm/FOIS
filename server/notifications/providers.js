import { findUserById, listRecords } from "../storage.js";

const WAGON_STOCK_PREFIX_RE = /^(BOX|BOB|BOS|BCN|BTP|NMG)/;
const WAGON_STOCK_CODES = new Set([
  "BCN",
  "BCNA",
  "BCNAHSM1",
  "BCNHL",
  "BOBR",
  "BOBRN",
  "BOBRNHSM1",
  "BOBRNHSM2",
  "BOSM",
  "BOST",
  "BOXCL",
  "BOXN",
  "BOXNEL",
  "BOXNHA",
  "BOXNHL",
  "BOXNHL25T",
  "BOXNR",
  "BTPN",
  "NMG",
  "NMGH",
]);

function hasAny(values) {
  return Array.isArray(values) && values.length > 0;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isWagonStockType(value) {
  const normalized = normalizeCode(value);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return true;
  if (WAGON_STOCK_CODES.has(normalized)) return true;
  return WAGON_STOCK_PREFIX_RE.test(normalized);
}

function readRaw(movement, ...keys) {
  const raw = movement?.raw_data || {};
  const normalizedRaw = Object.entries(raw).reduce((acc, [key, value]) => {
    acc[normalizeCode(key)] = value;
    return acc;
  }, {});
  for (const key of keys) {
    const value = raw[key] ?? movement?.[key] ?? normalizedRaw[normalizeCode(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function getPreferenceRakeCmdt(movement) {
  const candidates = [
    movement?.rake_commodity_code,
    movement?.rake_cmdt,
    readRaw(movement, "Rake CMDT", "RAKE CMDT", "rake_cmdt", "rakeCmdt"),
  ];

  for (const candidate of candidates) {
    const value = normalizeCode(candidate);
    if (!value || isWagonStockType(value)) continue;
    return value;
  }

  return "";
}

function preferenceMatches(preference, notification, context = {}) {
  const type = notification?.type || context.notification_type || "";

  if (type === "Arrival" || type === "Inward") {
    if (preference.inward_enabled === false) return false;
  }
  if (type === "Departure" || type === "Outward") {
    if (preference.outward_enabled === false) return false;
  }

  const stationCode = context.station_code || notification.station_code;
  if (hasAny(preference.stations) && !preference.stations.includes(stationCode)) {
    return false;
  }

  const movement = context.movement || {};
  if (hasAny(preference.zones)) {
    const zones = [movement.from_zone, movement.to_zone, movement.zone].filter(Boolean);
    if (!preference.zones.some((zone) => zones.includes(zone))) return false;
  }
  if (hasAny(preference.states)) {
    const states = [movement.from_state, movement.to_state, movement.state].filter(Boolean);
    if (!preference.states.some((state) => states.includes(state))) return false;
  }
  if (hasAny(preference.districts)) {
    const districts = [movement.from_district, movement.to_district, movement.district].filter(Boolean);
    if (!preference.districts.some((district) => districts.includes(district))) return false;
  }
  if (hasAny(preference.commodities)) {
    const commodity = movement.commodity_code || movement.commodity;
    if (!preference.commodities.includes(commodity)) return false;
  }
  if (hasAny(preference.rakeCmdts)) {
    const rakeCmdt = getPreferenceRakeCmdt(movement);
    if (!preference.rakeCmdts.includes(rakeCmdt)) return false;
  }

  return true;
}

async function getPreferenceEmail(preference) {
  const direct = firstPresent(preference.email, preference.user_email);
  if (direct) return direct;

  const user = await findUserById(preference.user_id).catch(() => null);
  return firstPresent(user?.email);
}

function getMovementDetails(movement = {}, notification = {}, context = {}) {
  const isOutward = movement.movement_type === "Outward" || notification.type === "Departure";
  const station = firstPresent(
    context.station_code,
    notification.station_code,
    isOutward ? movement.station_from : movement.station_to,
    movement.station_from,
    movement.station_to
  );
  const state = firstPresent(
    isOutward ? movement.from_state : movement.to_state,
    movement.state,
    movement.from_state,
    movement.to_state
  );
  const district = firstPresent(
    isOutward ? movement.from_district : movement.to_district,
    movement.district,
    movement.from_district,
    movement.to_district
  );

  return {
    Movement: firstPresent(movement.movement_type, notification.type, context.notification_type),
    Station: station,
    State: state,
    District: district,
    Company: firstPresent(
      movement.company_name,
      movement.company_full_name,
      movement.company_code,
      movement.company,
      readRaw(movement, "Company", "Company Name", "CNSR", "cnsr")
    ),
    Product: firstPresent(
      movement.product_name,
      movement.product_code,
      movement.product,
      readRaw(movement, "Product", "Product Name")
    ),
    Commodity: firstPresent(
      movement.commodity_name,
      movement.commodity_code,
      movement.commodity,
      readRaw(movement, "CMDT", "Commodity")
    ),
    "Rake CMDT": firstPresent(
      movement.rake_commodity_name,
      movement.rake_commodity_code,
      movement.rake_cmdt,
      readRaw(movement, "Rake CMDT", "RAKE CMDT")
    ),
    Wagons: firstPresent(movement.wagons, readRaw(movement, "Wagons", "indented_units")),
    "Departure Date": firstPresent(movement.departure_date, readRaw(movement, "Departure Date")),
    "Arrival Date & Time": [movement.arrival_date, readRaw(movement, "Arrival Time", "UpdatedTime")]
      .filter(Boolean)
      .join(" "),
    FNR: firstPresent(movement.fnr, movement.odr_number, readRaw(movement, "FNR", "indent_no")),
  };
}

function buildEmailBody(notification, context) {
  const movement = context.movement || {};
  const details = getMovementDetails(movement, notification, context);
  const lines = [
    "RailFlow FOIS found a matching record for your notification preference.",
    "",
    ...Object.entries(details).map(([label, value]) => `${label}: ${value || "-"}`),
    "",
    `Notification: ${notification.title || notification.type || "-"}`,
    notification.message ? `Message: ${notification.message}` : "",
  ].filter((line) => line !== "");
  return lines.join("\n");
}

function missingSesEnv() {
  return [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "SES_FROM_EMAIL",
  ].filter((key) => !String(process.env[key] || "").trim());
}

async function sendAwsSesEmail({ preference, notification, context }) {
  if (process.env.EMAIL_PROVIDER !== "aws_ses") {
    console.info("[NotificationDelivery] email skipped, provider not configured", {
      user_id: preference.user_id,
      notification_id: notification.id,
      provider: process.env.EMAIL_PROVIDER || "none",
    });
    return { status: "skipped", reason: "provider_not_configured" };
  }

  const missing = missingSesEnv();
  if (missing.length > 0) {
    console.info("[NotificationDelivery] email skipped, AWS SES env missing", {
      user_id: preference.user_id,
      notification_id: notification.id,
      missing,
    });
    return { status: "skipped", reason: "missing_config" };
  }

  const to = await getPreferenceEmail(preference);
  if (!to) {
    console.info("[NotificationDelivery] email skipped, user email missing", {
      user_id: preference.user_id,
      notification_id: notification.id,
    });
    return { status: "skipped", reason: "missing_recipient" };
  }

  try {
    const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
    const client = new SESClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    await client.send(
      new SendEmailCommand({
        Source: process.env.SES_FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: process.env.SES_REPLY_TO_EMAIL
          ? [process.env.SES_REPLY_TO_EMAIL]
          : undefined,
        Message: {
          Subject: {
            Charset: "UTF-8",
            Data: "RailFlow FOIS Alert - Matching Record Found",
          },
          Body: {
            Text: {
              Charset: "UTF-8",
              Data: buildEmailBody(notification, context),
            },
          },
        },
      })
    );

    console.info("[NotificationDelivery] email sent", {
      user_id: preference.user_id,
      notification_id: notification.id,
      provider: "aws_ses",
      to,
    });
    return { status: "sent" };
  } catch (error) {
    console.error("[NotificationDelivery] email failed", {
      user_id: preference.user_id,
      notification_id: notification.id,
      provider: "aws_ses",
      error: error?.message,
    });
    return { status: "failed", error: error?.message };
  }
}

async function sendWhatsApp({ preference, notification }) {
  if (!process.env.META_WHATSAPP_TOKEN || !process.env.META_WHATSAPP_PHONE_NUMBER_ID) {
    console.info("[NotificationDelivery] WhatsApp skipped, provider not configured", {
      user_id: preference.user_id,
      notification_id: notification.id,
    });
    return { status: "skipped", reason: "provider_not_configured" };
  }

  console.info("[NotificationDelivery] WhatsApp provider configured, send not implemented", {
    user_id: preference.user_id,
    notification_id: notification.id,
    provider: "meta-cloud-api",
  });
  return { status: "skipped", reason: "not_implemented" };
}

function enabledProviders() {
  return [
    {
      channel: "email",
      send: sendAwsSesEmail,
    },
    {
      channel: "whatsapp",
      send: sendWhatsApp,
    },
  ];
}

export async function dispatchNotification(notification, context = {}) {
  const preferences = await listRecords("UserNotificationPreference", {
    limit: 100000,
  }).catch(() => []);
  const providers = enabledProviders();

  if (preferences.length === 0) {
    return { matched: 0, delivered: 0, skipped: 0, failed: 0 };
  }

  const matched = preferences.filter((preference) =>
    preferenceMatches(preference, notification, context)
  );

  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  for (const preference of matched) {
    const channelProviders = providers.filter((provider) => {
      if (provider.channel === "email") return preference.email_enabled === true;
      if (provider.channel === "whatsapp") return preference.whatsapp_enabled === true;
      return false;
    });

    for (const provider of channelProviders) {
      try {
        const result = await provider.send({ preference, notification, context });
        if (result?.status === "sent") delivered += 1;
        else if (result?.status === "failed") failed += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        console.error("[NotificationDelivery] provider failed", {
          user_id: preference.user_id,
          notification_id: notification.id,
          channel: provider.channel,
          error: error?.message,
        });
      }
    }
  }

  return { matched: matched.length, delivered, skipped, failed };
}
