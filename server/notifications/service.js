// Centralized notification creation + dedup logic.
// This file must be the single entry point for ALL RailNotification creation.

import { createRecord } from "../storage.js";
import { dispatchNotification } from "./providers.js";

/**
 * Dedup key components required by spec:
 * - movement_reference
 * - station_code
 * - notification_type
 */
function buildDedupQueryParams({
  movement_reference,
  station_code,
  notification_type,
}) {
  return {
    movement_reference: movement_reference ?? null,
    station_code: station_code ?? null,
    notification_type: String(notification_type ?? ""),
  };
}

function buildDedupSelector({
  movement_reference,
  station_code,
  notification_type,
}) {
  // NOTE: query is implemented using storage layer access.
  // Dedup is based on triple, inside notification_history.
  return {
    movement_reference,
    station_code,
    notification_type,
  };
}

/**
 * Create a notification with dedup logic.
 *
 * Dedup check:
 * movement_reference + station_code + notification_type
 * against notification_history.
 */
export async function createNotification({
  // required by dedup
  movement_reference,
  station_code,
  notification_type,

  // RailNotification fields
  type, // maps to RailNotification.type (MissingODR, DuplicateODR, etc.)
  title,
  message,
  severity = "info",
  is_read = false,
  related_odr = null,
  related_division = null,
  batch_id = null,

  // optional: allow callers to pass extra data; stored in RailNotification via entityStore JSONB.
  data = {},
} = {}) {
  // Defensive normalizations
  const normalized_notification_type = String(notification_type ?? type ?? "");
  const dedup = buildDedupSelector({
    movement_reference: movement_reference ?? null,
    station_code: station_code ?? null,
    notification_type: normalized_notification_type,
  });

  // If storage is in JSON mode, we cannot reliably query notification_history.
  // But we still keep the API stable.
  // For now: attempt via postgres storage by importing pg only if needed is not possible here.

  // We will implement dedup using direct SQL in postgres mode via entityStore
  // by falling back to listRecords + createRecord in JSON mode.
  //
  // storage.js does not expose listRecords with filter for notification_history keys
  // so we use its listRecords.
  const { listRecords } = await import("../storage.js");

  const historyMatches = await listRecords("notification_history", {
    filter: {
      movement_reference: dedup.movement_reference,
      station_code: dedup.station_code,
      notification_type: dedup.notification_type,
    },
    limit: 1,
  }).catch(() => []);

  if (Array.isArray(historyMatches) && historyMatches.length > 0) {
    return {
      created: false,
      notification: historyMatches[0],
    };
  }

  // Create RailNotification
  const railNotification = await createRecord("RailNotification", {
    type: type ?? normalized_notification_type,
    title: title ?? "",
    message: message ?? "",
    severity,
    is_read,
    related_odr,
    related_division,
    batch_id,
    ...data,
  });

  await dispatchNotification(railNotification, {
    movement_reference: dedup.movement_reference,
    station_code: dedup.station_code,
    notification_type: normalized_notification_type,
    movement: data?.movement || data?.record || null,
  }).catch((error) => {
    console.error("[NotificationDelivery] dispatch failed", {
      notification_id: railNotification?.id,
      error: error?.message,
    });
  });

  // Create notification_history entry.
  // event_key is required by schema; we derive a deterministic key
  // based on movement_reference + station_code + notification_type.
  const event_key = [
    normalized_notification_type,
    dedup.station_code ?? "null",
    dedup.movement_reference ?? "null",
  ].join("|");

  // Persist notification_history (dedup key = movement_reference + station_code + notification_type)
  await createRecord("notification_history", {
    event_key,
    notification_type: normalized_notification_type,
    station_code: dedup.station_code,
    movement_reference: dedup.movement_reference,
  });

  return {
    created: true,
    notification: railNotification,
  };
}

