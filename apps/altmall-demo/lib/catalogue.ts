/**
 * AltMall synthetic catalogue (sandbox demo). Products are brand-neutral and fictional; product
 * imagery is drawn in-house as inline SVG line-art (components/ProductArt.tsx). Prices are integer kobo.
 *
 * Each category maps to exactly ONE fulfilling vendor because Pay with ARAF (for this partner)
 * finances one vendor per order.
 */

export type CategorySlug = 'smartphones' | 'laptops' | 'televisions' | 'refrigerators' | 'washing-machines' | 'furniture' | 'solar';
export type ArtKind = 'phone' | 'laptop' | 'tv' | 'fridge' | 'washer' | 'sofa' | 'chair' | 'bed' | 'panel' | 'inverter';

export interface Vendor {
  reference: string;
  name: string;
  city: string;
}

export const VENDORS: Record<string, Vendor> = {
  'VENDOR-LEKKI-ELEC': { reference: 'VENDOR-LEKKI-ELEC', name: 'Lekki Electronics', city: 'Lagos' },
  'VENDOR-IKEJA-HOME': { reference: 'VENDOR-IKEJA-HOME', name: 'Ikeja Home Appliances', city: 'Lagos' },
  'VENDOR-ABUJA-FURN': { reference: 'VENDOR-ABUJA-FURN', name: 'Abuja Fine Furniture', city: 'Abuja' },
  'VENDOR-KANO-SOLAR': { reference: 'VENDOR-KANO-SOLAR', name: 'Kano Solar Systems', city: 'Kano' },
};

export interface Category {
  slug: CategorySlug;
  name: string;
  tagline: string;
  vendorReference: string;
  art: ArtKind;
}

export const CATEGORIES: Category[] = [
  { slug: 'smartphones', name: 'Smartphones', tagline: 'Flagship cameras, all-day batteries', vendorReference: 'VENDOR-LEKKI-ELEC', art: 'phone' },
  { slug: 'laptops', name: 'Laptops', tagline: 'For study, work and creative projects', vendorReference: 'VENDOR-LEKKI-ELEC', art: 'laptop' },
  { slug: 'televisions', name: 'Televisions', tagline: 'Big-screen evenings at home', vendorReference: 'VENDOR-LEKKI-ELEC', art: 'tv' },
  { slug: 'refrigerators', name: 'Refrigerators', tagline: 'Inverter cooling that rides out outages', vendorReference: 'VENDOR-IKEJA-HOME', art: 'fridge' },
  { slug: 'washing-machines', name: 'Washing machines', tagline: 'Quiet, efficient laundry days', vendorReference: 'VENDOR-IKEJA-HOME', art: 'washer' },
  { slug: 'furniture', name: 'Furniture', tagline: 'Handmade pieces for living and rest', vendorReference: 'VENDOR-ABUJA-FURN', art: 'sofa' },
  { slug: 'solar', name: 'Solar equipment', tagline: 'Reliable power, day and night', vendorReference: 'VENDOR-KANO-SOLAR', art: 'panel' },
];

export interface Product {
  sku: string;
  name: string;
  category: CategorySlug;
  vendorReference: string;
  priceKobo: number;
  description: string;
  highlights: string[];
  specs: Array<[string, string]>;
  art: ArtKind;
  /** Accent variant for the illustration (0–2). */
  tone: 0 | 1 | 2;
  featured?: boolean;
}

const N = (naira: number) => naira * 100;

export const PRODUCTS: Product[] = [
  // ---- Smartphones (Lekki Electronics) ----
  {
    sku: 'ALT-PHN-6701', name: '6.7″ Pro Camera Smartphone, 256 GB', category: 'smartphones', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(645_000), art: 'phone', tone: 0, featured: true,
    description: 'A large, bright AMOLED display with a triple-lens camera system tuned for low light, and a 5,000 mAh battery that comfortably lasts a full Lagos day.',
    highlights: ['50 MP main + 12 MP ultra-wide + 10 MP telephoto', '120 Hz AMOLED display', '45 W fast charging'],
    specs: [['Display', '6.7″ AMOLED, 120 Hz'], ['Storage', '256 GB'], ['Memory', '12 GB RAM'], ['Battery', '5,000 mAh'], ['Network', '5G, dual SIM'], ['Warranty', '12 months']],
  },
  {
    sku: 'ALT-PHN-6102', name: '6.1″ Compact Smartphone, 128 GB', category: 'smartphones', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(398_500), art: 'phone', tone: 1,
    description: 'A one-hand-friendly phone with a clean, lightweight design, a dependable dual camera and a long software support window.',
    highlights: ['Fits comfortably in one hand', 'Dual 48 MP camera', 'IP54 splash resistance'],
    specs: [['Display', '6.1″ OLED, 90 Hz'], ['Storage', '128 GB'], ['Memory', '8 GB RAM'], ['Battery', '4,300 mAh'], ['Network', '5G, dual SIM'], ['Warranty', '12 months']],
  },
  {
    sku: 'ALT-PHN-6503', name: '6.5″ Everyday Smartphone, 128 GB', category: 'smartphones', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(189_900), art: 'phone', tone: 2,
    description: 'Great value with a big screen, expandable storage and a battery built for heavy social media and video calls.',
    highlights: ['Expandable to 1 TB', '6,000 mAh battery', 'Side fingerprint sensor'],
    specs: [['Display', '6.5″ LCD, 90 Hz'], ['Storage', '128 GB + microSD'], ['Memory', '6 GB RAM'], ['Battery', '6,000 mAh'], ['Network', '4G LTE, dual SIM'], ['Warranty', '12 months']],
  },
  // ---- Laptops (Lekki Electronics) ----
  {
    sku: 'ALT-LAP-1401', name: '14″ Ultralight Laptop, 16 GB / 512 GB', category: 'laptops', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(1_185_000), art: 'laptop', tone: 0, featured: true,
    description: 'An aluminium ultralight with a sharp 2.8K display, all-day battery life and a backlit keyboard — built for people who work on the move.',
    highlights: ['1.2 kg aluminium chassis', 'Up to 14 hours battery', '2.8K anti-glare display'],
    specs: [['Display', '14″ 2.8K IPS'], ['Processor', '10-core mobile processor'], ['Memory', '16 GB'], ['Storage', '512 GB NVMe SSD'], ['Weight', '1.2 kg'], ['Warranty', '24 months']],
  },
  {
    sku: 'ALT-LAP-1502', name: '15.6″ Student Laptop, 8 GB / 256 GB', category: 'laptops', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(485_000), art: 'laptop', tone: 1,
    description: 'A dependable full-size laptop for assignments, research and video lectures, with a full keyboard and numeric pad.',
    highlights: ['Full-size keyboard with number pad', 'HD webcam with privacy shutter', 'Fast SSD storage'],
    specs: [['Display', '15.6″ Full HD'], ['Processor', '6-core mobile processor'], ['Memory', '8 GB'], ['Storage', '256 GB SSD'], ['Weight', '1.7 kg'], ['Warranty', '12 months']],
  },
  {
    sku: 'ALT-LAP-1603', name: '16″ Creator Laptop, 32 GB / 1 TB', category: 'laptops', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(2_350_000), art: 'laptop', tone: 2,
    description: 'Colour-accurate display and a dedicated graphics processor for editing, design and 3D work.',
    highlights: ['100% DCI-P3 colour display', 'Dedicated 8 GB graphics', 'Thunderbolt-class ports'],
    specs: [['Display', '16″ 3.2K, 120 Hz'], ['Processor', '14-core performance processor'], ['Memory', '32 GB'], ['Storage', '1 TB NVMe SSD'], ['Graphics', '8 GB dedicated'], ['Warranty', '24 months']],
  },
  // ---- Televisions (Lekki Electronics) ----
  {
    sku: 'ALT-TV-5501', name: '55″ 4K Smart TV', category: 'televisions', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(565_000), art: 'tv', tone: 0, featured: true,
    description: 'Vivid 4K HDR picture with built-in streaming apps, voice remote and a slim bezel that disappears into the room.',
    highlights: ['4K HDR10+', 'Built-in streaming apps', 'Voice remote'],
    specs: [['Screen', '55″ 4K UHD LED'], ['HDR', 'HDR10+, HLG'], ['Refresh rate', '60 Hz'], ['Connectivity', '3× HDMI, 2× USB, Wi-Fi'], ['Audio', '20 W stereo'], ['Warranty', '24 months']],
  },
  {
    sku: 'ALT-TV-6502', name: '65″ 4K QLED Smart TV', category: 'televisions', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(1_095_000), art: 'tv', tone: 1,
    description: 'Quantum-dot colour, a 120 Hz panel for sport and gaming, and Dolby-style surround sound.',
    highlights: ['Quantum-dot colour', '120 Hz for sport and gaming', '40 W 2.1 channel audio'],
    specs: [['Screen', '65″ 4K QLED'], ['HDR', 'HDR10+, HLG'], ['Refresh rate', '120 Hz'], ['Connectivity', '4× HDMI 2.1, Wi-Fi 6'], ['Audio', '40 W 2.1'], ['Warranty', '24 months']],
  },
  {
    sku: 'ALT-TV-4303', name: '43″ Full HD Smart TV', category: 'televisions', vendorReference: 'VENDOR-LEKKI-ELEC', priceKobo: N(298_000), art: 'tv', tone: 2,
    description: 'An efficient, bedroom-sized smart TV with low power draw — ideal on inverter or solar power.',
    highlights: ['Low 55 W power draw', 'Built-in streaming apps', 'Wall-mount ready'],
    specs: [['Screen', '43″ Full HD LED'], ['Refresh rate', '60 Hz'], ['Connectivity', '2× HDMI, USB, Wi-Fi'], ['Power', '55 W typical'], ['Audio', '16 W stereo'], ['Warranty', '12 months']],
  },
  // ---- Refrigerators (Ikeja Home Appliances) ----
  {
    sku: 'ALT-FRG-3501', name: 'Double-Door Inverter Refrigerator, 350 L', category: 'refrigerators', vendorReference: 'VENDOR-IKEJA-HOME', priceKobo: N(689_000), art: 'fridge', tone: 0, featured: true,
    description: 'Frost-free cooling with an inverter compressor that keeps food cold for hours through power cuts while sipping energy.',
    highlights: ['Keeps cool up to 10 hours without power', 'Frost-free', 'Wide voltage protection'],
    specs: [['Capacity', '350 L (250 L fridge / 100 L freezer)'], ['Compressor', 'Inverter'], ['Energy', 'A++'], ['Dimensions', '60 × 65 × 178 cm'], ['Voltage', '140–260 V'], ['Warranty', '24 months; 5 years compressor']],
  },
  {
    sku: 'ALT-FRG-5502', name: 'Side-by-Side Refrigerator with Dispenser, 550 L', category: 'refrigerators', vendorReference: 'VENDOR-IKEJA-HOME', priceKobo: N(1_420_000), art: 'fridge', tone: 1,
    description: 'Generous family capacity with a chilled water dispenser, twin cooling and a quiet inverter compressor.',
    highlights: ['Chilled water dispenser', 'Twin cooling system', 'Door alarm'],
    specs: [['Capacity', '550 L'], ['Compressor', 'Inverter'], ['Energy', 'A+'], ['Dimensions', '91 × 70 × 179 cm'], ['Voltage', '140–260 V'], ['Warranty', '24 months; 10 years compressor']],
  },
  // ---- Washing machines (Ikeja Home Appliances) ----
  {
    sku: 'ALT-WSH-0801', name: 'Front-Load Washing Machine, 8 kg', category: 'washing-machines', vendorReference: 'VENDOR-IKEJA-HOME', priceKobo: N(545_000), art: 'washer', tone: 0,
    description: 'A quiet direct-drive motor, 15 wash programmes and a steam hygiene cycle for whites and baby clothes.',
    highlights: ['Steam hygiene cycle', '1,400 rpm spin', 'Delay start'],
    specs: [['Capacity', '8 kg'], ['Spin speed', '1,400 rpm'], ['Programmes', '15'], ['Motor', 'Direct-drive inverter'], ['Dimensions', '60 × 55 × 85 cm'], ['Warranty', '24 months']],
  },
  {
    sku: 'ALT-WSH-1102', name: 'Top-Load Automatic Washer, 11 kg', category: 'washing-machines', vendorReference: 'VENDOR-IKEJA-HOME', priceKobo: N(412_000), art: 'washer', tone: 1,
    description: 'Big-drum family washer with a low water mode for areas with limited supply and a child lock.',
    highlights: ['Low-water mode', 'Child lock', 'Tub self-clean'],
    specs: [['Capacity', '11 kg'], ['Spin speed', '800 rpm'], ['Programmes', '8'], ['Dimensions', '58 × 60 × 98 cm'], ['Voltage', '180–240 V'], ['Warranty', '12 months']],
  },
  // ---- Furniture (Abuja Fine Furniture) ----
  {
    sku: 'ALT-FUR-SF3', name: 'Three-Seater Fabric Sofa', category: 'furniture', vendorReference: 'VENDOR-ABUJA-FURN', priceKobo: N(785_000), art: 'sofa', tone: 0, featured: true,
    description: 'Solid hardwood frame, high-resilience foam cushions and a durable woven fabric in warm stone grey. Made to order in Abuja.',
    highlights: ['Kiln-dried hardwood frame', 'Removable, washable covers', 'Made to order in 10 working days'],
    specs: [['Dimensions', '220 × 92 × 84 cm'], ['Frame', 'Kiln-dried hardwood'], ['Upholstery', 'Woven polyester blend'], ['Seats', '3'], ['Assembly', 'Delivered assembled'], ['Warranty', '5 years frame']],
  },
  {
    sku: 'ALT-FUR-CH1', name: 'Upholstered Lounge Chair', category: 'furniture', vendorReference: 'VENDOR-ABUJA-FURN', priceKobo: N(246_000), art: 'chair', tone: 1,
    description: 'A compact reading chair with a gently reclined back, solid wood legs and a textured bouclé-style fabric.',
    highlights: ['Solid wood legs', 'Compact footprint', 'Textured fabric'],
    specs: [['Dimensions', '74 × 80 × 88 cm'], ['Frame', 'Hardwood'], ['Upholstery', 'Textured weave'], ['Assembly', 'Legs attach in minutes'], ['Warranty', '2 years']],
  },
  {
    sku: 'ALT-FUR-BD6', name: 'King-Size Bed Frame with Headboard', category: 'furniture', vendorReference: 'VENDOR-ABUJA-FURN', priceKobo: N(918_500), art: 'bed', tone: 2,
    description: 'A solid wood king-size bed with a padded headboard and slatted base. Mattress not included.',
    highlights: ['Padded headboard', 'Solid wood slats', 'Under-bed clearance for storage'],
    specs: [['Size', 'King (6 × 6 ft)'], ['Material', 'Solid hardwood'], ['Headboard', 'Padded fabric'], ['Assembly', 'Assembled on delivery'], ['Warranty', '5 years frame']],
  },
  // ---- Solar (Kano Solar Systems) ----
  {
    sku: 'ALT-SOL-3K', name: '3 kVA Home Solar Kit (4 panels + battery)', category: 'solar', vendorReference: 'VENDOR-KANO-SOLAR', priceKobo: N(2_485_000), art: 'panel', tone: 0, featured: true,
    description: 'A complete, professionally installed kit: four monocrystalline panels, a 3 kVA hybrid inverter and a 2.4 kWh lithium battery. Powers lights, fans, TV and a fridge.',
    highlights: ['Installation included', 'Lithium battery, 6,000 cycles', 'Mobile app monitoring'],
    specs: [['Inverter', '3 kVA hybrid, pure sine wave'], ['Panels', '4 × 450 W monocrystalline'], ['Battery', '2.4 kWh LiFePO₄'], ['Backup', 'Approx. 6–8 hours typical load'], ['Installation', 'Included within 50 km'], ['Warranty', '5 years inverter & battery']],
  },
  {
    sku: 'ALT-SOL-INV', name: '1.5 kVA Inverter with Lithium Battery', category: 'solar', vendorReference: 'VENDOR-KANO-SOLAR', priceKobo: N(865_000), art: 'inverter', tone: 1,
    description: 'Quiet, fume-free backup power for apartments. Charges from the grid or panels and switches over automatically.',
    highlights: ['Automatic switchover', 'Silent operation', 'Solar-ready'],
    specs: [['Inverter', '1.5 kVA pure sine wave'], ['Battery', '1.2 kWh LiFePO₄'], ['Backup', 'Approx. 4–6 hours (lights, fans, TV)'], ['Input', 'Grid or up to 2 panels'], ['Warranty', '3 years']],
  },
];

export const PRODUCT_BY_SKU: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.sku, p]));

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function productsIn(slug: string): Product[] {
  return PRODUCTS.filter((p) => p.category === slug);
}

/** Pay with ARAF partner rules for AltMall (mirrors the configuration agreed with the Bank). */
export const ARAF_RULES = { minKobo: 20_000 * 100, maxKobo: 5_000_000 * 100, singleVendor: true };

export const MAX_QTY = 10;

/**
 * Indicative monthly example shown on product pages. It is a plain division of the price over an
 * illustrative 12 months — it is NOT a quote, does not include the Bank's profit and is subject
 * to eligibility. Real terms are only shown inside Pay with ARAF.
 */
export function illustrativeMonthlyKobo(priceKobo: number, months = 12): number {
  return Math.ceil(priceKobo / months / 100) * 100;
}
