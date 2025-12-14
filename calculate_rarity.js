import fs from 'fs';
import axios from 'axios';

// ==========================================
// KONFİQURASİYA
// ==========================================
const CID = "QmawxnmmzngbiYe1PSgc9YEthFX11uiTtT6YPdUdLD3x3E";
const TOTAL_SUPPLY = 2222;
const FILE_PATH = 'public/rarity_data.json';

// Gateway Siyahısı (Biri işləməsə digərinə keçəcək)
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
            // 5 saniyə vaxt qoyuruq
            const { data } = await axios.get(url, { timeout: 5000 });
            return data;
        } catch (err) {
            await sleep(1000); // 1 saniyə gözləyib yenidən yoxlayır
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

    // 1. KÖHNƏ DATANI YÜKLƏ (Qaldığı yerdən davam etmək üçün)
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
        // Əgər bu ID artıq doludursa, təkrar yükləmə
        if (finalMap[i] && finalMap[i].raw_attributes && finalMap[i].raw_attributes.length > 0) {
            continue; 
        }

        const data = await fetchMetadata(i);

        if (data) {
            // Sizin atributları birbaşa yadda saxlayırıq
            finalMap[i] = {
                id: i,
                raw_attributes: data.attributes || [] 
            };
            successCount++;
            console.log(`✅ Loaded #${i}`);
        } else {
            failCount++;
            console.error(`❌ Failed #${i}`);
            // Boş yazırıq ki, skript dayanmasın (sonra düzəldilə bilər)
            if (!finalMap[i]) finalMap[i] = { id: i, raw_attributes: [] }; 
        }

        // Hər 20 NFT-dən bir yaddaşa yaz (Backup)
        if (i % 20 === 0) {
            saveProgress(finalMap);
            console.log(`💾 Yadda saxlanıldı #${i}. Uğurlu: ${successCount}, Xəta: ${failCount}`);
        }

        // Serveri yormamaq üçün fasilə
        await sleep(100); 
    }

    // 3. HESABLAMA
    console.log("🧮 Bütün data yığıldı. İndi hesablanır...");
    calculateRanks(finalMap);

    // 4. SON NƏTİCƏ
    saveProgress(finalMap);
    console.log("✅ Proses bitdi! 'public/rarity_data.json' hazırdır.");
}

// RANK HESABLAMA MƏNTİQİ
function calculateRanks(mapData) {
    let allNFTs = Object.values(mapData);
    let traitCounts = {};

    // 1. Sayğac: Hər xüsusiyyətdən neçə dənə var?
    // Məsələn: "Background||Serena Dale" -> 50 ədəd
    allNFTs.forEach(nft => {
        const attrs = nft.raw_attributes || [];
        attrs.forEach(attr => {
            if(attr.trait_type && attr.value) {
                const key = `${attr.trait_type}||${attr.value}`;
                traitCounts[key] = (traitCounts[key] || 0) + 1;
            }
        });
    });

    // 2. Score verilməsi
    allNFTs.forEach(nft => {
        let totalScore = 0;
        let processedTraits = [];
        const attrs = nft.raw_attributes || [];

        attrs.forEach(attr => {
            if(attr.trait_type && attr.value) {
                const key = `${attr.trait_type}||${attr.value}`;
                const count = traitCounts[key] || 0;
                
                // Faiz (Məsələn 0.05 = 5%)
                const percentRaw = count > 0 ? (count / TOTAL_SUPPLY) : 0;
                const percentDisplay = (percentRaw * 100).toFixed(1) + "%";
                
                // Score = 1 / faiz (Nadir olanın balı yüksək olur)
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

    // 3. Sıralama (Rank) - Ən çox bal yığan Rank 1
    allNFTs.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

    // 4. Type təyini (Mythic, Legendary...)
    allNFTs.forEach((nft, index) => {
        const rank = index + 1;
        let type = "common";
        
        // Sizin bölgüyə əsasən
        if (rank <= 22) type = "mythic";
        else if (rank <= 132) type = "legendary";
        else if (rank <= 462) type = "epic";
        else if (rank <= 1122) type = "rare";
        else type = "common";

        // Map-ə yazırıq (ID əsasında)
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
