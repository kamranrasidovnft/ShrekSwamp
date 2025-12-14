import fs from 'fs';
import axios from 'axios';

// ==========================================
// KONFİQURASİYA
// ==========================================
const CID = "QmW8hYi9DHd3BSMtiCe2uTDFymz43HtQSVpMPiDiupaVY3";
const TOTAL_SUPPLY = 2222; // Sizin istədiyiniz say
const FILE_PATH = 'public/rarity_data.json';

// Gateway Siyahısı
const GATEWAYS = [
    "https://dweb.link/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
    "https://gateway.pinata.cloud/ipfs/"
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Metadata Çəkmək (Retry Məntiqi)
async function fetchMetadata(id) {
    for (const gateway of GATEWAYS) {
        try {
            const url = `${gateway}${CID}/${id}.json`;
            const { data } = await axios.get(url, { timeout: 5000 });
            return data;
        } catch (err) {
            await sleep(1000); 
            continue;
        }
    }
    return null;
}

async function generateRarity() {
    console.log("🚀 Rarity prosesi başladı...");

    if (!fs.existsSync('public')){
        fs.mkdirSync('public');
    }

    // 1. KÖHNƏ DATANI YÜKLƏ
    let finalMap = {};
    if (fs.existsSync(FILE_PATH)) {
        try {
            const raw = fs.readFileSync(FILE_PATH);
            finalMap = JSON.parse(raw);
            console.log(`📦 Mövcud fayl tapıldı. ${Object.keys(finalMap).length} NFT artıq yaddaşdadır.`);
        } catch(e) {
            console.log("⚠️ Fayl oxuna bilmədi, sıfırdan başlayırıq.");
        }
    }

    let successCount = 0;
    let failCount = 0;

    // 2. METADATA YÜKLƏMƏ DÖVRÜ
    for (let i = 1; i <= TOTAL_SUPPLY; i++) {
        if (finalMap[i] && finalMap[i].raw_attributes && finalMap[i].raw_attributes.length > 0) {
            continue; 
        }

        const data = await fetchMetadata(i);

        if (data) {
            finalMap[i] = {
                id: i,
                raw_attributes: data.attributes || [] 
            };
            successCount++;
            console.log(`✅ Loaded #${i}`);
        } else {
            failCount++;
            console.error(`❌ Failed #${i}`);
            if (!finalMap[i]) finalMap[i] = { id: i, raw_attributes: [] }; 
        }

        if (i % 20 === 0) {
            saveProgress(finalMap);
            console.log(`💾 Yadda saxlanıldı #${i}. Uğurlu: ${successCount}, Xəta: ${failCount}`);
        }

        await sleep(100); 
    }

    // 3. HESABLAMA
    console.log("🧮 Bütün data yığıldı. İndi hesablanır...");
    calculateRanks(finalMap);

    // 4. SON NƏTİCƏ
    saveProgress(finalMap);
    console.log("✅ Proses bitdi! 'public/rarity_data.json' hazırdır.");
}

// RANK HESABLAMA MƏNTİQİ (SİZİN OPENSEA RANGELƏRİNİZ)
function calculateRanks(mapData) {
    let allNFTs = Object.values(mapData);
    let traitCounts = {};

    // A. Bütün traitlərin sayını tapırıq
    allNFTs.forEach(nft => {
        const attrs = nft.raw_attributes || [];
        attrs.forEach(attr => {
            if(attr.trait_type && attr.value) {
                const key = `${attr.trait_type}||${attr.value}`;
                traitCounts[key] = (traitCounts[key] || 0) + 1;
            }
        });
    });

    // B. Hər NFT üçün "Rarity Score" hesablayırıq
    allNFTs.forEach(nft => {
        let totalScore = 0;
        let processedTraits = [];
        const attrs = nft.raw_attributes || [];

        attrs.forEach(attr => {
            if(attr.trait_type && attr.value) {
                const key = `${attr.trait_type}||${attr.value}`;
                const count = traitCounts[key] || 0;
                
                // Faiz (0.01 = 1%)
                const percentRaw = count > 0 ? (count / TOTAL_SUPPLY) : 0;
                const percentDisplay = (percentRaw * 100).toFixed(1) + "%";
                
                // Nadirlik balı (OpenSea stili: Trait Rarity Score)
                let score = 0;
                if(percentRaw > 0) score = 1 / percentRaw;
                
                totalScore += score;

                processedTraits.push({
                    trait_type: attr.trait_type,
                    value: attr.value,
                    percent: percentDisplay,
                    score: score
                });
            }
        });

        nft.totalScore = totalScore;
        nft.traits = processedTraits;
    });

    // C. Sıralama (Rank) - Ən çox bal yığan Rank 1 olur
    allNFTs.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

    // D. Type Təyini (SİZİN TƏLƏB ETDİYİNİZ INTERVAL)
    allNFTs.forEach((nft, index) => {
        const rank = index + 1;
        let type = "common"; 
        
        // Rank 1 - 22: Legendary
        if (rank <= 22) {
            type = "legendary"; 
        } 
        // Rank 23 - 222: Epic
        else if (rank <= 222) {
            type = "epic";      
        } 
        // Rank 223 - 555: Rare
        else if (rank <= 555) {
            type = "rare";      
        } 
        // Rank 556 - 2222: Common
        else {
            type = "common";    
        }

        // Map-ə yazırıq
        mapData[nft.id] = {
            rank: rank,
            type: type,
            score: (nft.totalScore || 0).toFixed(2),
            traits: nft.traits
        };
    });
}

function saveProgress(data) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

generateRarity();
