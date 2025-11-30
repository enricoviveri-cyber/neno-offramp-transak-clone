require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ==================== CONFIGURAZIONE ====================
const SERVICE_WALLET = (process.env.SERVICE_WALLET_ADDRESS || '').trim();
const PRICE_PER_NENO = 1000.00;
const FEE_PERCENT = 2.5;
const MAX_NENO_PER_TX = 25;        // ← 25 NENO = 24.375 € netti → PASSA SEMPRE

if (!SERVICE_WALLET) {
  console.error('ERRORE: Imposta SERVICE_WALLET_ADDRESS su Render!');
  process.exit(1);
}

console.log(`NENO OFF-RAMP TRANSAK CLONE ATTIVO`);
console.log(`Prezzo: 1 NENO = €\( {PRICE_PER_NENO} | Max \){MAX_NENO_PER_TX} NENO per transazione`);

// ==================== CREA OFF-RAMP ====================
app.post('/create-offramp', async (req, res) => {
  const { nenoAmount, email, fullName, iban } = req.body;
  const amount = parseFloat(nenoAmount);

  // Controlli base
  if (!amount || amount <= 0 || !email || !iban || !fullName) {
    return res.status(400).json({ error: "Compila tutti i campi" });
  }

  // Limite sicuro (fase di lancio)
  if (amount > MAX_NENO_PER_TX) {
    return res.status(400).json({ 
      error: `Massimo ${MAX_NENO_PER_TX} NENO per transazione (24.375 € netti). Torneremo a limiti più alti presto!` 
    });
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
          product_data: { 
            name: `Vendita ${amount.toFixed(6)} NENO a 1.000€/NENO` 
          },
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
      receiveEUR: eurNet,
      message: "Paga prima → poi invia i NENO"
    });

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ 
      error: 'Pagamento non autorizzato – usa una carta diversa o riduci l\'importo' 
    });
  }
});

// ==================== WEBHOOK ALCHEMY ====================
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

    if (to.toLowerCase() === SERVICE_WALLET.toLowerCase() && amount >= 0.1) {
      console.log(`NENO RICEVUTI: \( {amount.toFixed(6)} → valore € \){(amount * 1000).toFixed(2)}`);
      console.log(`Tx: https://bscscan.com/tx/${tx.hash}`);
      // Qui in futuro: bonifico automatico Wise
    }
  }
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OFF-RAMP NENO ATTIVO sulla porta ${PORT}`);
  console.log(`Limite attuale: ${MAX_NENO_PER_TX} NENO per transazione`);
});
