// Vercel serverless function: PayFast ITN (Instant Transaction Notification)
// sink. PayFast's recurring billing requires a notify URL it can POST
// payment confirmations to and expects an HTTP 200 back - without one,
// subscriptions can be cancelled server-side by PayFast. We don't process
// the notifications (email receipts + the PayFast dashboard cover
// bookkeeping); this just acknowledges them.
module.exports = (req, res) => {
    res.status(200).send('OK');
};
