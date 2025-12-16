import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// Konfiqurasiya
const PORT = 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Statik Fayllar
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "dist")));
app.use('/rarity_data.json', express.static(path.join(__dirname, "dist/rarity_data.json")));

// API: Bütün NFT-ləri gətir
app.get("/api/nfts", async (req, res) => {
  const { data, error } = await supabase.from("metadata").select("*").order("tokenid");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ nfts: data });
});

// API: FREE MINT
app.post("/api/freemint", async (req, res) => {
    const { address } = req.body;
    if(!address) return res.status(400).json({error: "Address required"});
    
    const user = address.toLowerCase();

    // 1. Yoxla: Bu adam artıq mint edib?
    const { data: existing } = await supabase
        .from("metadata")
        .select("tokenid")
        .or(`buyer_address.eq.${user},seller_address.eq.${user}`)
        .limit(1);

    if(existing && existing.length > 0) {
        return res.status(400).json({ error: "Siz artıq NFT almısız! (Limit: 1)" });
    }

    // 2. Boş NFT tap (Sahibi olmayan)
    const { data: available } = await supabase
        .from("metadata")
        .select("tokenid")
        .is("buyer_address", null)
        .is("seller_address", null)
        .limit(1);

    if(!available || available.length === 0) {
        return res.status(400).json({ error: "Bütün NFT-lər bitib! (Sold Out)" });
    }

    const tokenID = available[0].tokenid;

    // 3. NFT-ni istifadəçiyə ver
    const { error: updateErr } = await supabase
        .from("metadata")
        .update({ 
            buyer_address: user,
            updatedat: new Date().toISOString()
        })
        .eq("tokenid", tokenID);

    if(updateErr) return res.status(500).json({ error: "Database Xətası" });

    res.json({ success: true, tokenid: tokenID });
});

// API: Sifariş Yarat (List)
app.post("/api/order", async (req, res) => {
    const { tokenid, price, seller_address, seaport_order, order_hash } = req.body;
    const { error } = await supabase.from("metadata").upsert({
        tokenid: tokenid.toString(),
        price: price,
        seller_address: seller_address.toLowerCase(),
        buyer_address: null,
        seaport_order: seaport_order,
        order_hash: order_hash,
        updatedat: new Date().toISOString()
    }, { onConflict: "tokenid" });
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// API: Satın Alma (Buy)
app.post("/api/buy", async (req, res) => {
    const { tokenid, buyer_address, price, seller } = req.body;
    
    // Metadata-nı yenilə
    await supabase.from("metadata").update({
        buyer_address: buyer_address.toLowerCase(),
        seller_address: null,
        price: 0,
        seaport_order: null,
        updatedat: new Date().toISOString()
    }).eq("tokenid", tokenid.toString());

    // Tarixçə yaz (Orders table)
    await supabase.from("orders").insert({
        tokenid: tokenid.toString(),
        seller_address: seller,
        buyer_address: buyer_address.toLowerCase(),
        price: price,
        status: 'completed'
    });

    res.json({ success: true });
});

// SPA Routing (Hər şeyi index.html-ə yönləndir)
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dist/index.html")));

app.listen(PORT, () => console.log(`Backend işə düşdü: Port ${PORT}`));
