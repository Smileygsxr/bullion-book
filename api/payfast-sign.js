// Vercel serverless function: signs PayFast payment requests server-side.
//
// PayFast requires an MD5 signature (computed with the account's secret
// passphrase) on every custom-integration payment once a passphrase is set -
// and subscriptions REQUIRE a passphrase. The passphrase must never reach
// the browser, so the donate modal posts { amount, monthly } here and gets
// back the full, signed field set to submit to PayFast's payment page.
//
// Setup: add PAYFAST_PASSPHRASE in Vercel > Project > Settings >
// Environment Variables, with exactly the same value as PayFast >
// Settings > Integration > Security passphrase. Redeploy after adding.
const crypto = require('crypto');

const SITE_URL = 'https://bullion-book.vercel.app';

// Signature fields must be concatenated in PayFast's documented attribute
// order (NOT alphabetical) - only non-empty fields are included.
const PAYFAST_FIELD_ORDER = [
    'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
    'name_first', 'name_last', 'email_address', 'cell_number',
    'm_payment_id', 'amount', 'item_name', 'item_description',
    'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
    'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
    'email_confirmation', 'confirmation_address', 'payment_method',
    'subscription_type', 'billing_date', 'recurring_amount', 'frequency', 'cycles'
];

// PayFast expects PHP-urlencode style encoding: spaces as '+', uppercase hex
function pfEncode(value) {
    return encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
}

module.exports = (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }

    const passphrase = process.env.PAYFAST_PASSPHRASE;
    if (!passphrase) {
        res.status(500).json({ error: 'PAYFAST_PASSPHRASE is not configured on the server.' });
        return;
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const amount = parseFloat(body.amount);
    const monthly = !!body.monthly;
    if (isNaN(amount) || amount < 5 || amount > 1000000) {
        res.status(400).json({ error: 'Amount must be between R5 and R1,000,000.' });
        return;
    }

    const fields = {
        merchant_id: '11228864',
        merchant_key: 'sckcpnodrnppx',
        return_url: `${SITE_URL}/`,
        cancel_url: `${SITE_URL}/`,
        notify_url: `${SITE_URL}/api/payfast-notify`,
        amount: amount.toFixed(2),
        item_name: monthly ? 'Bullion Book Membership' : 'Support Bullion Book',
        item_description: monthly
            ? 'Monthly membership supporting Bullion Book, a free online trading journal.'
            : 'Voluntary donation supporting Bullion Book, a free online trading journal.'
    };

    if (monthly) {
        fields.subscription_type = '1'; // recurring subscription
        fields.recurring_amount = amount.toFixed(2);
        fields.frequency = '3';         // monthly
        fields.cycles = '0';            // until cancelled
    }

    const signatureString = PAYFAST_FIELD_ORDER
        .filter(key => fields[key] !== undefined && fields[key] !== '')
        .map(key => `${key}=${pfEncode(fields[key])}`)
        .join('&') + `&passphrase=${pfEncode(passphrase)}`;

    fields.signature = crypto.createHash('md5').update(signatureString).digest('hex');

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ action: 'https://www.payfast.co.za/eng/process', fields });
};
