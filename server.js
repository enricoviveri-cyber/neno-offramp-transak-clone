require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const SERVICE_WALLET = process.env.SERVICE_WALLET_ADDRESS.trim();
const PRICE_PER_NENO = 1000.00;
const FEE_PERCENT = 2.5;
const WISE_TOKEN = process.env.WISE_API_TOKEN;

console.log(`NENO OFF-RAMP TRANSAK CLONE ATTIVO – 1 NENO = €${PRICE_PER_NENO}`);

app.post('/create-offramp', async (req, res) => {
  const { nenoAmount, email, fullName, iban } = req.body;
  const amount = parseFloat(nenoAmount);

  if (!amount || amount <= 0 || !email || !iban || !fullName) {
    return res.status(400).json({ error: "Compila tutti i campi" });
  }

  const eurGross = (amount * PRICE_PER_NENO).toFixed(2);
  const eurNet   = (amount * PRICE_PER_NENO * (1 - FEE_PERCENT / 100)).toFixed(2);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Vendita ${amount.toFixed(6)} NENO` },
          unit_amount: Math.round(eurNet * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/success.html`,
      cancel_url:  `${req.headers.origin}/cancel.html`,
      metadata: {
        type: 'neno_offramp',
        neno_amount: amount.toString(),
        user_email: email,
        user_name: fullName,
        user_iban: iban,
        eur_net: eurNet
      }
    });

    res.json({
      success: true,
      paymentUrl: session.url,
      wallet: SERVICE_WALLET,
      nenoToSend: amount.toFixed(6),
      receiveEUR: eurNet
    });

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Errore pagamento – riprova' });
  }
});

// Webhook Alchemy (conferma arrivo NENO → bonifico automatico)
app.post('/webhook/alchemy', express.raw({ type: 'application/json' }), async (req, res) => {
  let payload;
  try { payload = JSON.parse(req.body); } catch { return res.status(400).send(); }

  const txs = payload.event?.data?.block?.transactions || [];
  for (const tx of txs) {
    if (!tx.input?.startsWith('0xa9059cbb')) continue;
    if (tx.to?.toLowerCase() !== '0xeF3F5C1892A8d7A3304E4A15959E124402d69974'.toLowerCase()) continue;

    const to = '0x' + tx.input.slice(34, 74);
    const value = BigInt('0x' + tx.input.slice(74));
    const amount = Number(value) / 1e18;

    if (to.toLowerCase() === SERVICE_WALLET.toLowerCase() && amount >= 1) {
      const eurToSend = (amount * 1000 * 0.975).toFixed(2);
      console.log(`NENO RICEVUTI: \( {amount} → BONIFICO \){eurToSend}€ IN USCITA`);

      // Qui puoi salvare in DB + inviare bonifico reale (vedi sotto)
    }
  }
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Off-ramp live sulla porta ${PORT}`));
