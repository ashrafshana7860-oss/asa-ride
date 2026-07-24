-- ASA RIDE - Supabase Database Schema
-- Supabase -> SQL Editor -> New Query -> Paste -> Run

-- 1. DRIVERS TABLE
CREATE TABLE IF NOT EXISTS drivers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  city TEXT,
  state TEXT,
  imei TEXT NOT NULL,
  licence_no TEXT,
  rc_no TEXT,
  commission_pct INTEGER DEFAULT 12,
  launch_rides_remaining INTEGER DEFAULT 100,
  status TEXT DEFAULT 'pending',
  is_online BOOLEAN DEFAULT false,
  rides_count INTEGER DEFAULT 0,
  wallet_balance NUMERIC(10,2) DEFAULT 0,
  last_lat NUMERIC(10,7),
  last_lng NUMERIC(10,7),
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. CUSTOMERS TABLE
CREATE TABLE IF NOT EXISTS customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  wallet_balance NUMERIC(10,2) DEFAULT 0,
  ride_count INTEGER DEFAULT 0,
  first_ride_done BOOLEAN DEFAULT false,
  refer_code TEXT UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  referred_by UUID REFERENCES customers(id),
  refer_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. RIDES TABLE
CREATE TABLE IF NOT EXISTS rides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  driver_id UUID REFERENCES drivers(id),
  pickup_address TEXT,
  drop_address TEXT,
  pickup_lat NUMERIC(10,7),
  pickup_lng NUMERIC(10,7),
  drop_lat NUMERIC(10,7),
  drop_lng NUMERIC(10,7),
  vehicle_type TEXT,
  distance_km NUMERIC(6,2),
  fare NUMERIC(8,2),
  driver_earn NUMERIC(8,2),
  platform_earn NUMERIC(8,2),
  comm_pct_applied INTEGER DEFAULT 0,
  cancel_charge NUMERIC(6,2) DEFAULT 0,
  otp TEXT,
  status TEXT DEFAULT 'searching',
  cancel_reason TEXT,
  payment_method TEXT DEFAULT 'cash',
  payment_status TEXT DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. PAYOUTS TABLE
CREATE TABLE IF NOT EXISTS payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID REFERENCES drivers(id),
  amount NUMERIC(10,2),
  upi_id TEXT,
  status TEXT DEFAULT 'pending',
  txn_id TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- 5. REFERRALS TABLE
CREATE TABLE IF NOT EXISTS referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID REFERENCES customers(id),
  referred_id UUID REFERENCES customers(id),
  reward_amount NUMERIC(8,2) DEFAULT 500,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. ROW LEVEL SECURITY
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "service_all_drivers" ON drivers FOR ALL USING (true);
CREATE POLICY "service_all_customers" ON customers FOR ALL USING (true);
CREATE POLICY "service_all_rides" ON rides FOR ALL USING (true);
CREATE POLICY "service_all_payouts" ON payouts FOR ALL USING (true);
CREATE POLICY "service_all_referrals" ON referrals FOR ALL USING (true);

-- 7. INDEXES
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_online ON drivers(is_online);
CREATE INDEX IF NOT EXISTS idx_rides_customer ON rides(customer_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

SELECT 'ASA RIDE DB Setup Complete!' AS message;
