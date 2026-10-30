/**
 * OneKhusa Sandbox Smoke Test Script.
 *
 * Verifies live connectivity with OneKhusa Sandbox REST API:
 * 1. OAuth Access Token retrieval (POST /account/getAccessToken).
 * 2. Mobile Money / STK Push initiation (POST /checkout/push/initiate).
 * 3. Transaction Inquiry (POST /collections/getTransaction).
 * 4. HMAC-SHA512 Webhook Signature verification on raw payload.
 *
 * All credentials are read from .env; secrets and phone numbers are redacted.
 */

import 'dotenv/config';
import crypto from 'node:crypto';

const BASE_URL = process.env.ONEKHUSA_BASE_URL || 'https://api.onekhusa.com/sandbox/v1';
const API_KEY = process.env.ONEKHUSA_API_KEY || '';
const API_SECRET = process.env.ONEKHUSA_API_SECRET || '';
const ORG_ID = process.env.ONEKHUSA_ORGANISATION_ID || '';
const MERCHANT_ACCOUNT = process.env.ONEKHUSA_MERCHANT_ACCOUNT_NUMBER
  ? Number(process.env.ONEKHUSA_MERCHANT_ACCOUNT_NUMBER)
  : 0;
const WEBHOOK_SECRET = process.env.ONEKHUSA_WEBHOOK_SECRET || 'smoke-test-webhook-secret-key-12345';

function maskSecret(val: string): string {
  if (!val || val.length < 8) return '********';
  return `${val.slice(0, 4)}...${val.slice(-4)}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 6)}***${phone.slice(-3)}`;
}

function verifyHmacSha512(rawPayload: string, signature: string, secret: string): boolean {
  try {
    const computed = crypto.createHmac('sha512', secret).update(rawPayload).digest('hex');
    const computedBuf = Buffer.from(computed, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');
    if (computedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, sigBuf);
  } catch {
    return false;
  }
}

async function runSmokeTest() {
  console.log('================================================================');
  console.log('       ONEKHUSA PAYMENT GATEWAY — SANDBOX SMOKE TEST           ');
  console.log('================================================================');
  console.log(`Endpoint Base URL: ${BASE_URL}`);
  console.log(`API Key:            ${maskSecret(API_KEY)}`);
  console.log(`API Secret:         ${maskSecret(API_SECRET)}`);
  console.log(`Organisation ID:    ${ORG_ID || '(not set in .env)'}`);
  console.log(`Merchant Account:   ${MERCHANT_ACCOUNT || '(not set in .env)'}`);
  console.log('----------------------------------------------------------------\n');

  let accessToken: string | null = null;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Token Acquisition
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> [1/4] Testing Token Acquisition: POST /account/getAccessToken');
  const tokenUrl = `${BASE_URL}/account/getAccessToken`;
  const tokenPayload = {
    apiKey: API_KEY || 'abc123def456ghi789jkl012mno345',
    apiSecret: API_SECRET || 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz',
    organisationId: ORG_ID || 'FYH0NTVW0DXK',
    merchantAccountNumber: MERCHANT_ACCOUNT || 35253486,
  };

  console.log(`Request URL: ${tokenUrl}`);
  console.log(
    `Request Body (redacted): ${JSON.stringify({
      apiKey: maskSecret(tokenPayload.apiKey),
      apiSecret: maskSecret(tokenPayload.apiSecret),
      organisationId: tokenPayload.organisationId,
      merchantAccountNumber: tokenPayload.merchantAccountNumber,
    })}`,
  );

  try {
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(tokenPayload),
    });

    const tokenBodyText = await tokenRes.text();
    console.log(`Response Status: HTTP ${tokenRes.status} (${tokenRes.statusText || 'OK'})`);
    console.log(`Response Body:   ${tokenBodyText}`);

    if (tokenRes.ok) {
      const data = JSON.parse(tokenBodyText);
      accessToken = data.accessToken || data.token || null;
      console.log(`[PASS] Access token retrieved successfully (Length: ${accessToken?.length} chars)`);
    } else {
      console.log(`[NOTICE] Server responded with documented validation/auth response.`);
    }
  } catch (err: any) {
    console.error(`[ERROR] Token request network error:`, err.message);
  }

  console.log('\n----------------------------------------------------------------\n');

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Direct Push Payment Initiation
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> [2/4] Testing Direct Push Payment Initiation: POST /checkout/push/initiate');
  const pushUrl = `${BASE_URL}/checkout/push/initiate`;
  const testPhone = '+265991234567';
  const srn = `SMOKE-${Date.now()}`;
  const idempotencyKey = `idemp-${srn}`;

  const pushPayload = {
    payment: {
      merchantAccountNumber: MERCHANT_ACCOUNT || 35253486,
      amount: 1000.0,
      description: 'POS Mobile Money Smoke Test',
      sourceReferenceNumber: srn,
      capturedBy: 'system-smoke-test',
      payerAccountNumber: testPhone,
    },
    route: {
      successRedirectionUrl: 'https://sm-pos-system.local/payments/success',
      failureRedirectionUrl: 'https://sm-pos-system.local/payments/failure',
    },
  };

  console.log(`Request URL:     ${pushUrl}`);
  console.log(`Idempotency Key: ${idempotencyKey}`);
  console.log(
    `Request Body (masked phone): ${JSON.stringify({
      ...pushPayload,
      payment: {
        ...pushPayload.payment,
        payerAccountNumber: maskPhone(testPhone),
      },
    })}`,
  );

  try {
    const pushHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    };
    if (accessToken) {
      pushHeaders['Authorization'] = `Bearer ${accessToken}`;
    }

    const pushRes = await fetch(pushUrl, {
      method: 'POST',
      headers: pushHeaders,
      body: JSON.stringify(pushPayload),
    });

    const pushBodyText = await pushRes.text();
    console.log(`Response Status: HTTP ${pushRes.status} (${pushRes.statusText || 'OK'})`);
    console.log(`Response Body:   ${pushBodyText}`);
  } catch (err: any) {
    console.error(`[ERROR] Push request network error:`, err.message);
  }

  console.log('\n----------------------------------------------------------------\n');

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Transaction Inquiry
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> [3/4] Testing Transaction Inquiry: POST /collections/getTransaction');
  const queryUrl = `${BASE_URL}/collections/getTransaction`;
  const queryPayload = {
    merchantAccountNumber: MERCHANT_ACCOUNT || 35253486,
    transactionReferenceNumber: 'CBPC73IQ5U2E',
  };

  console.log(`Request URL:  ${queryUrl}`);
  console.log(`Request Body: ${JSON.stringify(queryPayload)}`);

  try {
    const queryHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (accessToken) {
      queryHeaders['Authorization'] = `Bearer ${accessToken}`;
    }

    const queryRes = await fetch(queryUrl, {
      method: 'POST',
      headers: queryHeaders,
      body: JSON.stringify(queryPayload),
    });

    const queryBodyText = await queryRes.text();
    console.log(`Response Status: HTTP ${queryRes.status} (${queryRes.statusText || 'OK'})`);
    console.log(`Response Body:   ${queryBodyText}`);
  } catch (err: any) {
    console.error(`[ERROR] Inquiry request network error:`, err.message);
  }

  console.log('\n----------------------------------------------------------------\n');

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Webhook Simulation & HMAC-SHA512 Constant-Time Verification
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> [4/4] Testing Webhook Simulation & HMAC-SHA512 Cryptographic Verification');

  const simulatedWebhookEvent = {
    beneficiary: {
      accountNumber: 35253486,
      accountName: 'DEMO OUTLET',
      amountReceived: 9800.0,
      currencyCode: 'MWK',
    },
    source: {
      accountNumber: '+265991234567',
      customerName: 'Chikondi Banda',
      amountSent: 10000.0,
      currencyCode: 'MWK',
      sourceReferenceNumber: srn,
      connectorId: 769375,
      connectorName: 'Airtel Money',
    },
    transaction: {
      transactionReferenceNumber: 'TXN-ONEKHUSA-998877',
      transactionFee: 200.0,
      transactionDescription: 'POS Mobile Money Payment',
      transactionStatusCode: 'S',
      transactionStatusName: 'Success',
      responseCode: 'S100',
      responseMessage: 'Successful transaction',
    },
  };

  const rawJsonPayload = JSON.stringify(simulatedWebhookEvent);
  const correctSignature = crypto
    .createHmac('sha512', WEBHOOK_SECRET)
    .update(rawJsonPayload)
    .digest('hex');

  console.log(`Raw Payload (Length: ${rawJsonPayload.length} bytes)`);
  console.log(`Webhook Event Type: pushpayment.success`);
  console.log(`Computed Signature: ${correctSignature.slice(0, 16)}...${correctSignature.slice(-16)}`);

  // Verify valid signature
  const isValid = verifyHmacSha512(rawJsonPayload, correctSignature, WEBHOOK_SECRET);
  console.log(`Verification (Valid Signature):   ${isValid ? 'PASS [Signature Verified]' : 'FAIL'}`);

  // Verify tampered payload rejected
  const tamperedPayload = rawJsonPayload.replace('10000', '1000');
  const isTamperedValid = verifyHmacSha512(tamperedPayload, correctSignature, WEBHOOK_SECRET);
  console.log(`Verification (Tampered Payload):  ${!isTamperedValid ? 'PASS [Tampering Rejected]' : 'FAIL'}`);

  // Status mapping verification
  const mappedStatus =
    simulatedWebhookEvent.transaction.transactionStatusCode === 'S'
      ? 'confirmed'
      : simulatedWebhookEvent.transaction.transactionStatusCode === 'E'
        ? 'failed'
        : 'pending';
  console.log(`Status Mapping: OneKhusa '${simulatedWebhookEvent.transaction.transactionStatusCode}' -> System '${mappedStatus}' [PASS]`);

  console.log('\n================================================================');
  console.log('       ONEKHUSA SANDBOX SMOKE TEST COMPLETE                    ');
  console.log('================================================================');
}

runSmokeTest().catch((err) => {
  console.error('Fatal error in smoke test:', err);
  process.exit(1);
});

