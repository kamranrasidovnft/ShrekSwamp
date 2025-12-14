import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// =======================================
// SUPABASE
// =======================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =======================================
// CONSTANTS
// =======================================
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const MARKETPLACE_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS;

const RPC_LIST = [
  process.env.APECHAIN_RPC,
  "https://rpc.apechain.com/http",
  "https://apechain.drpc.org",
  "https://33139.rpc.thirdweb.com"
];

// RPC failover
let providerIndex = 0;
function getProvider() {
  const rpc = RPC_LIST[providerIndex % RPC_LIST.length];
  providerIndex++;
  return new ethers.providers.JsonRpcProvider(rpc);
}

let provider = getProvider();

// =======================================
// NFT ABI
// =======================================
const nftABI = [
  "function ownerOf(uint256 tokenid) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256 tokenid) view returns (string)"
];

let nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, nftABI, provider);

// =======================================
// HELPERS
// =======================================
function convertIPFStoHTTP(uri) {
  if (!uri) return null;
  return uri.startsWith("ipfs://")
    ? uri.replace("ipfs://", "https://ipfs.io/ipfs/")
    : uri;
}

// =======================================================
//   PROCESS NFT FUNCTION
// =======================================================
async function processNFT(tokenid) {
  try {
    let owner, tokenURI, success = false;

    // RPC Failover: owner + tokenURI alma
    for (let i = 0; i < RPC_LIST.length; i++) {
      try {
        owner = await nftContract.ownerOf(tokenid);
        tokenURI = await nftContract.tokenURI(tokenid);
        success = true;
        break;
      } catch (err) {
        if (err.message?.includes("owner query for nonexistent token")) return;
        provider = getProvider();
        nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, nftABI, provider);
      }
    }

    if (!success) throw new Error("All RPC endpoints failed");

    // =============================
    // Metadata Fetch
    // =============================
    const httpURI = convertIPFStoHTTP(tokenURI);
    let name = null;
    let image = null;

    try {
      const metadataRes = await fetch(httpURI);
      const metadata = await metadataRes.json();
      name = metadata.name || `Steptract Genesis #${tokenid}`;
      image = metadata.image || httpURI;
    } catch {
      name = `Steptract Genesis #${tokenid}`;
      image = httpURI;
    }

    const now = new Date().toISOString();

    // =============================
    //   ADIM 1: Mövcud DB məlumatlarını almaq
    // =============================
    const { data: existingData } = await supabase
      .from("metadata")
      .select("buyer_address, seaport_order, price, order_hash")
      .eq("tokenid", tokenid.toString())
      .single();

    // =============================
    //   ADIM 2: Sahibi dəyişibsə listingi sil
    // =============================
    let shouldWipeOrder = false;

    if (
      existingData &&
      existingData.buyer_address &&
      existingData.buyer_address.toLowerCase() !== owner.toLowerCase()
    ) {
      console.log(`♻️ NFT #${tokenid} sahibi dəyişib → Köhnə listing silinir.`);
      shouldWipeOrder = true;
    }

    // =============================
    //   ADIM 3: Upsert Data Hazırlanır
    // =============================
    const upsertData = {
      tokenid: tokenid.toString(),
      nft_contract: NFT_CONTRACT_ADDRESS,
      marketplace_contract: MARKETPLACE_CONTRACT_ADDRESS,
      buyer_address: owner.toLowerCase(),
      on_chain: true,
      name,
      image,
      updatedat: now,
      createdat: now 
    };

    // =============================
    //   ADIM 4: Listing məlumatlarını saxla və ya sıfırla
    // =============================
    if (!shouldWipeOrder && existingData) {
      // Listing eyni qalır
      upsertData.seaport_order = existingData.seaport_order;
      upsertData.price = existingData.price;
      upsertData.order_hash = existingData.order_hash;
    } else {
      // Sahibi dəyişəndə sıfırlanır
      upsertData.seaport_order = null;
      upsertData.price = null;
      upsertData.order_hash = null;
    }

    // =============================
    //   ADIM 5: Upsert
    // =============================
    await supabase.from("metadata").upsert(upsertData, {
      onConflict: "tokenid"
    });

    console.log(`✅ NFT #${tokenid} sync OK → Owner: ${owner}`);
  } catch (e) {
    console.warn(`❌ NFT #${tokenid} ERROR:`, e.message);
  }
}

// =======================================================
// MAIN
// =======================================================
async function main() {
  try {
    const totalSupply = await nftContract.totalSupply();
    console.log(`🚀 Total minted NFTs: ${totalSupply}`);

    const BATCH_SIZE = 20;
    for (let i = 1; i < totalSupply; i += BATCH_SIZE) {
      const batch = Array.from(
        { length: BATCH_SIZE },
        (_, j) => i + j
      ).filter(id => id < totalSupply);

      await Promise.allSettled(batch.map(tokenid => processNFT(tokenid)));
    }

    console.log("🎉 NFT metadata + owner sync tamamlandı!");
  } catch (err) {
    console.error("💀 Fatal error:", err.message);
    process.exit(1);
  }
}

main();
