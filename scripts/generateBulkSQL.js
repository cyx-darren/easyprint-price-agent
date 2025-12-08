/**
 * Generate bulk SQL INSERT for all pricing records
 * Outputs SQL suitable for execute_sql
 */

const fs = require('fs');
const data = require('/tmp/parsed_data.json');

const productIds = {
  "10L Waterproof Dry Bags": "ac7beb14-5846-4842-86d3-fe095b4d04d6",
  "2 Tone Nylon Bags": "79f827f5-ea61-4caf-ab48-eeeac17d8a36",
  "2 Tone Zipper Pouch": "df0fe6a9-9a08-4558-a8b7-d5627186fdf3",
  "21\" Foldable Auto Umbrella with Pouch": "3384d081-c271-4670-844a-de2eec7ccb54",
  "22\" Foldable Umbrella": "7a8a3991-d08e-409e-999e-a12264665a69",
  "23\" Umbrellas": "aaca516e-1638-4d85-a704-1cfd91db46e4",
  "28\" Foldable Auto Umbrella with Pouch": "3e2ddc74-1668-4ae9-955a-46fb1ec6078c",
  "2ply Dri Fit Mask": "9f286fbc-2b5d-459c-a043-6f25387c4ced",
  "30\" Black Straight Handle Umbrella with Pouch": "aceaa38b-5979-4588-bce8-6cbe0b6bd0e6",
  "30\" Polyester Solid Fabric Golf Umbrella": "cbc091f9-115c-4a57-9cb0-f828e56a5478",
  "30\" Silver Coated Golf Umbrella": "ac7d472a-7dda-4ac7-83e3-639ca0ecb17a",
  "5L Waterproof Dry Bags": "4b475fde-a454-4aef-a5d6-78c9fd177a43",
  "A3 Canvas Black Tote Bag": "884befce-8d9e-4398-96d4-b6953fbf5e4b",
  "A3 Canvas Cream Tote Bag": "5ad71d93-9441-4616-b3fb-3d8afeb384de",
  "A3 Canvas Tote Bag": "e8f8210f-b177-44b1-a35d-b703d091ba10",
  "A3 Coloured Jute Bags": "a8c993a2-d4e9-4d95-958d-934902d3d27d",
  "A3 Jute Bags": "a7abe863-3e3a-42bf-93ee-c5fb194d2fae",
  "A3 Non Woven Bag": "7c713e76-45bb-4da0-b6d0-b255243ee54f",
  "A3 Non Woven Bag Square size": "88a7e405-d6b3-436b-abfa-92c2ec9cb016",
  "A3 Non Woven Bag Square Size": "98250521-e4b0-4fcf-ae9d-11c2a3387b55",
  "A4 Canvas Black Tote Bag": "f4721708-415b-4525-a156-6bae40601baa",
  "A4 Canvas Cream Tote Bag": "63b5d0d1-74e1-45ec-935d-c37f7f584cc7",
  "A4 Canvas Tote Bag": "c4a23172-94e7-4b1a-a81d-f5f456bdf1fe",
  "A4 Coloured Jute Bags": "34c33e9b-ef9f-49e7-9070-d7acde4f3e04",
  "A4 Jute Bag with Canvas": "9a438642-8f34-41cf-812e-19748ba2ceb0",
  "A4 Jute Bags": "8281a524-4107-4bf3-b08f-701bfa6782a7",
  "A4 Jute Bags with canvas": "db651554-4ae5-46ea-814a-1c4109fac9dc",
  "A4 Non Woven Bag": "4cddd60d-224e-43f8-ab7f-f0b0102a04b8",
  "A5 Non Woven Bag": "70c212ec-8165-4cb0-983d-19de489fee17",
  "Acrylic Card Holder Portrait": "766cb36c-ea95-4643-8bd8-e4e235788f9f",
  "Adjustable Strap Cotton Mask": "83b892e1-d1f0-4efb-8a64-aa3198ad529d",
  "Auto Golf Umbrella": "29e6adae-c380-40a9-89af-517b4f5ed3b4",
  "Black Nylon Cooler Bag": "76f2e1cb-9e5a-4466-949b-d84647fa5750",
  "Canvas Cup Carrier": "55df9d00-c15b-43ae-be1a-7028eaf4e4e8",
  "Canvas Pouch": "77bf218b-8437-43ad-92e6-b42da97451ce",
  "Classic Golf Umbrellas": "013e729f-2d5e-4361-832b-521501bedd2b",
  "Classique All Purpose Pouch": "ccc856f5-47fd-42b2-b1ee-5e0fd4e67ae2",
  "Cotton Drawstring Bags": "8a4e7424-634a-4911-af34-4dcc86139e06",
  "Cotton Sport Wristbands": "2d4a82c7-73dc-42b8-babe-d3a68e04b47f",
  "Creston Foldable Nylon Bag": "1efed160-5113-4aff-9590-0d05cd69518f",
  "Daxter Shoe Bags": "6bf5f816-0d5a-4ccd-8a20-2c1f138c56e8",
  "Deluxe Leather Card Holder": "ffca21a4-44d1-426f-8212-4331d3e73c8d",
  "Disposable Face Mask Set": "422100fe-8619-4887-8c2f-7957052f30c5",
  "Double Zipper Pouch": "6b6ff0a6-0b1f-48f0-9887-e7526bb913bc",
  "EcoChic Laminated Canvas Bag": "73459cac-02d8-4085-8f3e-49768ef4811f",
  "Exclusive Golf Bag": "f47d65aa-1bf0-4369-8e6d-9d94b60af798",
  "Explore Essential Nylon Travel Bag": "77e25737-31c8-4975-869b-b451e57dc1f1",
  "Express Handy Craft Paper Bag": "e50e2625-74c0-47f7-ba02-8c81127b8f96",
  "Express Mini Handy Craft Paper Bag": "976f5402-9eab-47ee-823c-6d2ea10a7dfb",
  "Floral Jute Bags": "4965a80f-68ce-442a-bddd-7025702d15f1",
  "Foldable Non Woven Bags": "d4f40982-d8af-473d-99c7-220cd0d1892f",
  "Foldable Nylon Bag with Zip": "1825a5ff-b379-41f5-827d-1c59c4a3d426",
  "Handy Craft Paper Bag": "54af5f00-8cfe-48ae-b863-318f527fcffc",
  "Jacquard Bag": "355e8d1b-baee-422c-82eb-36c5a13c234b",
  "K94 Masks": "6f60d82a-294d-4526-9470-89ddc872d2bc",
  "Laminated Jute Bags": "59a409cf-5354-402e-a547-aad0d66fd0a5",
  "Landon Multipurpose Pouch": "6629c320-8a50-48a5-bc40-a0663d025430",
  "Landscape Canvas Tote Bag": "a4fbe203-42d9-4211-90a1-e5e14c5a75d4",
  "Landscape Jute Bags": "d4771be1-cba9-4903-bd27-ae0680325251",
  "Langdon Foldable Nylon Bag": "cba88c24-ac57-48c5-b50d-b6c87d9103c0",
  "Laptop Case with Strap": "fdfc152c-c2f2-49ac-b3a6-ca53bb85016a",
  "Laptop Sleeves": "605c6fd9-265d-45b5-8f95-6403549fb502",
  "Large Cotton Canvas Pouch": "926e876c-d285-4aff-84db-ac81010b45f4",
  "Large Non Woven Bag": "c8dd798f-4614-48ed-9874-6e93c417d77a",
  "Leather Card Holder": "2820b09a-1ffc-4865-b662-1c3a422021c0",
  "Mini Handy Craft Paper Bag": "2ffeb558-4b9e-410a-b815-df2a098b2c00",
  "MIni Handy Craft Paper Bag": "2ffeb558-4b9e-410a-b815-df2a098b2c00",
  "Modern Backpack": "efc4ff83-e9d7-4b8c-94be-7426d02004db",
  "Morise Backpack": "aa466c1d-797a-413e-ad00-a10bea1137cb",
  "Non Woven Drawstring Bags": "96e5b407-6ef8-41cd-b9a5-4e50479a006a",
  "Nylon Backpack": "a2a44492-cdaa-4fb9-811a-b5920774d34d",
  "Nylon Cooler Bag": "36985f39-341d-4086-b784-02e41eea9ec5",
  "Nylon Drawstring Bags": "9f2ef8de-013c-45a2-a6cb-ac7ef837400e",
  "Nylon Jacquard Pouch": "75acfe0f-e199-4721-ba90-ff3632c08262",
  "Nylon Shoebag": "0f61bd64-19e7-4503-8a68-7327d677b74f",
  "Nylon Tote Bag": "a39e165c-7158-47c6-9bb2-d17d91a104db",
  "Nylon Travel Bag": "d701c046-9234-4bfe-bfaa-257a5ebe5c5d",
  "Nylon Zipper Pouch": "7014d4e5-622b-4404-a605-bc5c91cb3a95",
  "Paper Event Badges": "e7dbd913-5e54-490a-91e8-10ce4260934b",
  "Plain Lanyards": "fde1da93-9ea6-48c4-b624-de2ef1e1190a",
  "PVC Card Holder A6 Large Size": "42d8e9e3-56aa-44cb-aaff-6fe23dbc6130",
  "PVC Card Holder Credit Card Sized": "7a694933-d339-413e-8cb1-54744c71b2e1",
  "PVC Card Holder Medium Size": "cadadafa-e0c0-4bc3-b00b-183ecf00e53d",
  "PVC Event Badge": "d936c825-3c70-48f9-8e07-d567df026d4b",
  "Ready Stock Lanyard": "def7717b-474e-4f14-81f1-4f7c569356b8",
  "Ready Stock PVC Event Badge": "f9ca698a-5268-46dc-8139-42b67a5b9415",
  "Reversible Umbrellas": "bc931e42-27c7-4a3e-99a5-ade45da3c955",
  "Stationery Multipurpose Pouch": "e301f109-6574-4e9e-9c0e-14e46a56ec28",
  "Umbrella": "efc8d634-4baf-4986-9f58-732123a4fc4a",
  "Urgent 30\" Polyester Solid Fabric Golf Umbrella": "7fd18eed-22b7-49a1-b3f9-46f735411630",
  "Urgent 30\" Silver Coated Golf Umbrella": "6a714d96-8adf-4faa-8ae2-91a1f38a347d",
  "Urgent 30\" Straight Handle Umbrella with Pouch": "722de4dc-1076-4e97-b1f6-03604c791dbb",
  "Urgent A4 Coloured Jute Bags": "52b05a5a-5a0e-4cad-bf68-d2ab020a7e95",
  "Urgent Auto Golf Umbrella": "041ead16-cb37-4dc7-a10d-d0ea40941806",
  "Urgent Classic Golf Umbrellas": "92229abf-5d25-4360-8913-8e913b64d9aa",
  "Urgent Classique All Purpose Pouch": "4e8f14df-2f64-4b59-b1e4-0cca12415fe0",
  "Urgent Landscape Canvas Tote Bag": "51e4d98e-2818-4a12-8521-1071faf5dff5",
  "Urgent Lanyard Printing": "dae55f8c-cfcd-4433-9555-3770cc13de57",
  "Zania Backpack": "043de79b-8657-4d45-9c85-6abf0df69e14",
  "Zeta Multipurpose Pouch": "5ca4bd0f-42ec-4e10-97f6-759141f12a2e"
};

function escapeSQL(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

// Get batch from args
const batchNum = parseInt(process.argv[2]) || 0;
const batchSize = 500;
const start = batchNum * batchSize;
const end = Math.min(start + batchSize, data.records.length);

if (start >= data.records.length) {
  console.log('DONE');
  process.exit(0);
}

const batch = data.records.slice(start, end);

const values = batch.map(r => {
  const productId = productIds[r.product_name];
  if (!productId) return null;
  return `('${productId}', '${escapeSQL(r.product_name)}', '${escapeSQL(r.print_option)}', '${r.lead_time_type}', ${r.lead_time_days_min}, ${r.lead_time_days_max}, ${r.quantity}, ${r.unit_price}, ${r.is_moq})`;
}).filter(v => v !== null);

console.log(`INSERT INTO pricing (product_id, product_name, print_option, lead_time_type, lead_time_days_min, lead_time_days_max, quantity, unit_price, is_moq) VALUES ${values.join(', ')};`);

console.error(`Batch ${batchNum}: ${start}-${end} of ${data.records.length}`);
