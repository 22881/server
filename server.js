const express = require('express');
const cors = require('cors');
const stripe = require('stripe')('sk_test_51RlQIwIwHNIYYpTvFqeavjq6PyYZCdzkawCXJEn8K6dv7gj7jDvSXoFAt0rIVmbTMtVpaxETrgbPlYHKa4GDs65P00A2AvzQdW');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json'); // твій JSON ключ Google

const app = express();
const endpointSecret = 'whsec_ff449723d7558d6be972de38a743793611a5db5307cf7df495d2313765aa8248';

app.use(cors());

// Raw body для webhook, JSON для інших запитів
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    bodyParser.json()(req, res, next);
  }
});

// Google Sheets функція
async function writeToGoogleSheet(data) {
  const doc = new GoogleSpreadsheet('1phUJoThMN-PFG62ko3eA1TwkBub74S7RedSX038afNQ');
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0]; // перший лист

  await sheet.addRow({
    "Дата": new Date().toLocaleString('uk-UA'),
    "Номер замовлення": data.orderId,
    "Ім’я": data.firstname,
    "Прізвище": data.lastname,
    "Телефон": data.phone,
    "Email": data.email,
    "Адреса": data.address,
    "Статус": 'Оплата пройшла'
  });

  console.log('✅ Дані записані в Google Таблицю');
}

// Stripe checkout session
app.post('/create-checkout-session', async (req, res) => {
  const { cart, form } = req.body;

  const orderId = Math.floor(100000 + Math.random() * 900000).toString(); // шістизначний номер

  const line_items = cart.map(item => ({
    price_data: {
      currency: 'pln',
      product_data: { name: item.name },
      unit_amount: Math.round(item.price * 100)
    },
    quantity: 1
  }));

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      customer_email: form.email,
      success_url: `http://localhost:5500?success=true&orderId=${orderId}`,
      cancel_url: `http://localhost:5500/cancel`,
      metadata: {
        orderId,
        name: form.firstname,
        surname: form.lastname,
        phone: form.phone,
        address: form.address
      }
    });
  

    res.json({ id: session.id });
  } catch (err) {
    console.error('❌ Stripe error:', err.message);
    res.status(500).json({ error: 'Stripe session error' });
  }
});

// Webhook Stripe
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const orderData = {
      orderId: session.metadata.orderId,
      firstname: session.metadata.name,
      lastname: session.metadata.surname,
      phone: session.metadata.phone,
      email: session.customer_email,
      address: session.metadata.address
    };

    try {
      await writeToGoogleSheet(orderData);
    } catch (err) {
      console.error('❌ Google Sheets запис не вдався:', err.message);
    }
  }

  res.status(200).send('Webhook received');
});

app.listen(4242, () => {
  console.log('✅ Сервер працює на http://localhost:4242');
});
