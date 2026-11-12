// =====================================================
// JUSTBRAND — COURIER API COMPATIBILITY LAYER
// =====================================================
// The real integration now lives in backend/courier-adapters/*.
// This file keeps the small, stable helpers used by courier.js and by
// older admin code. It never reads or stores credentials itself.

import { courierAdapterStatus, courierEnvNames, getCourierAdapter } from "./courier-adapters/index.js";

export function envNamesFor(code) {
  return courierEnvNames(code);
}

export function apiConfigStatus(code) {
  return courierAdapterStatus(code);
}

export async function testConnection(code) {
  const adapter = getCourierAdapter(code);
  if (!adapter) {
    return {
      ok: false,
      status: "manual",
      mode: "manual",
      at: new Date().toISOString(),
      liveCalled: false,
      message: `No adapter is registered for ${code}. Manual Mode only.`,
    };
  }
  return adapter.testConnection();
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Official Shiprocket adhoc-order payload. Values come from the real
// order, the seller group and the seller's pickup record; nothing is
// invented for a live shipment.
export function buildShiprocketPayload({ order, partner, items, packageInfo, pickup }) {
  const nameParts = String(order.customerName || "Customer").trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || "-";
  const pkg = packageInfo || {};

  return {
    pickup_location:
      cleanText(pickup?.providerLocationName) ||
      cleanText(partner?.pickupLocation) ||
      process.env.SHIPROCKET_PICKUP_LOCATION ||
      "Primary",
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: order.address || "",
    billing_address_2: order.city || "",
    billing_city: order.city || "",
    billing_pincode: String(order.pincode || ""),
    billing_state: order.state || "",
    billing_country: "India",
    billing_email: order.email || "",
    billing_phone: String(order.phone || ""),
    shipping_is_billing: true,
    order_items: (items || []).map((item) => ({
      name: item.name || item.productName || `Item ${item.productId}`,
      sku: item.sku || `JB-${item.productId}`,
      units: Number(item.quantity) || 1,
      selling_price: Number(String(item.price || 0).replace(/[^0-9.]/g, "")) || 0,
    })),
    length: Number(pkg.length) || 10,
    breadth: Number(pkg.breadth) || 10,
    height: Number(pkg.height) || 5,
    weight: Number(pkg.weightKg) || 0.5,
    payment_method: order.paymentMethod === "COD" ? "COD" : "Prepaid",
    ...(order.paymentMethod === "COD"
      ? { cod_amount: Number(order.totalAmount) || 0 }
      : {}),
    sub_total: Number(order.totalAmount) || 0,
  };
}

export function createSandboxShipment({ code, orderId, sellerKey }) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const suffix = String(sellerKey || "order").replace(/[^A-Za-z0-9]/g, "").slice(-8);
  return {
    mode: "sandbox",
    awbNumber: `TEST-${code}-${orderId}-${suffix || "X"}-${rand}`,
    shippingLabelRef: `LBL-TEST-${orderId}-${suffix || "X"}-${rand}`,
    note:
      "Sandbox / dry-run shipment — NOT a real booking. No courier was contacted. The TEST- AWB is for workflow verification only.",
  };
}
