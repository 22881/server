const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json'); // Google Service Account

const app = express();
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.use(cors());
app.use(express.static('public'));

// Розділяємо raw і json тіла
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next(); // raw body
  } else {
    bodyParser.json()(req, res, next); // json для всього іншого
  }
});

// 📄 Функція запису в Google Таблицю
async function writeToGoogleSheet(data) {
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];
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

// ✅ Створення Stripe Checkout-сесії
app.post('/create-checkout-session', async (req, res) => {
  const { cart, form } = req.body;

  const orderId = Math.floor(100000 + Math.random() * 900000).toString();

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

// ✅ Webhook Stripe
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

// ✅ Запуск сервера
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`✅ Сервер працює на порті ${PORT}`);
});
