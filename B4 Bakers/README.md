# B4 Bakers

Bakery web app with:
- Product browsing (`index.html`, `more-products.html`)
- Cart and checkout (`cart.html`)
- Profile, delivery location, and order history (`profile.html`)
- OTP login/register backend using Express + Twilio Verify (`assets/js/main.js`)

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript, Bootstrap 5
- Backend: Node.js, Express, Twilio Verify API
- Storage:
  - Browser `localStorage` for cart, order history, and session state
  - `users-db.json` for registered users (server-side JSON file)

## Features

- Login/Register with OTP (phone-based)
- Delivery location save and sync to backend
- Add to cart with quantity controls
- Cart selection + payment modal flow
- Order success + WhatsApp bill message
- Order history on profile page
- Client-side pagination on More Products page (4 products per page)

## Project Structure

- `index.html`: home page, hero section, featured products, auth modal
- `more-products.html`: additional products + pagination UI/script
- `cart.html`: cart table, payment modal, success modal
- `profile.html`: user profile, location form, order history container
- `assets/css/main.css`: shared styles
- `assets/js/main.js`: backend APIs + frontend auth logic
- `assets/js/cart.js`: cart logic, checkout, stock persistence, order history save
- `assets/js/profile.js`: profile rendering, location update, order history read
- `scripts/setup-twilio-env.js`: interactive `.env` setup helper
- `users-db.json`: persisted registered users for local backend

## Prerequisites

- Node.js 
- npm
- Twilio account with Verify Service SID

## Installation

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env`:

```env
PORT=3000
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_real_auth_token
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

You can also run:

```bash
npm run setup:twilio
```

## Run

Start backend:

```bash
npm start
```

By default backend runs at:
- `http://localhost:3000`

Health check endpoint:
- `GET /auth/health`

## Backend API Endpoints

- `POST /auth/send-otp`
  - Body: `{ mode: "login" | "register", phone, name? }`
- `POST /auth/verify-otp`
  - Body: `{ mode: "login" | "register", phone, otp }`
- `POST /auth/update-location`
  - Body: `{ phone, location }`

## Frontend Data Keys (localStorage)

- `b4_bakers_cart`
- `b4_bakers_order_history`
- `b4_bakers_product_stock`
- `bubblebakery_auth_user`
- `bubblebakery_auth_session_token`
- `bubblebakery_auth_flow`

## Notes

- Order history is saved client-side in `localStorage` and rendered in profile.
- Backend is currently implemented inside `assets/js/main.js` (Node runtime path).
- If backend is not running, OTP and server location sync will fail; local UI still loads.

## Troubleshooting

- OTP send/verify fails:
  - Check `.env` values are real (not placeholders)
  - Confirm Twilio Verify service is active
  - Ensure backend is running on `http://localhost:3000`
- Login modal not opening from protected actions:
  - Check query param flow (`?openLogin=1`) and `assets/js/main.js` loaded in `index.html`
