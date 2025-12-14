import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// 1. SABİTLƏR (CONSTANTS)
// ==========================================

const ItemType = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3 };
const OrderType = { FULL_OPEN: 0, PARTIAL_OPEN: 1, FULL_RESTRICTED: 2, PARTIAL_RESTRICTED: 3 };

// Env Variables (və ya Default dəyərlər)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL; 
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0xc291adb9516a1377bb0ab369ef240488adfaa4bc"; 
const SEAPORT_ADDRESS = "0x0000000000000068f116a894984e2db1123eb395"; 
const APECHAIN_RPC = import.meta.env.VITE_APECHAIN_RPC || "https://rpc.apechain.com";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

// OPTIMIZASIYA (INFINITE SCROLL) DƏYİŞƏNLƏRİ
const BATCH_SIZE = 40; 
let currentFilteredList = []; 
let displayedCount = 0; 
let isLoadingMore = false; 

// Global Variables
let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;
let apePriceUsd = 0; 

let selectedTokens = new Set();
let allNFTs = []; 
let rarityData = {}; 
let currentFilter = 'all'; 
let currentSort = 'price_asc'; 
let targetPriceFilter = null; 

// UI Elements
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");

// Filter Count Elements
const countAllEl = document.getElementById("count-all");
const countListedEl = document.getElementById("count-listed");
const countUnlistedEl = document.getElementById("count-unlisted");
const countSoldEl = document.getElementById("count-sold");

// Bulk UI Elements
const bulkBar = document.getElementById("bulkBar");
const bulkCount = document.getElementById("bulkCount");
const bulkPriceInp = document.getElementById("bulkPrice");
const bulkListBtn = document.getElementById("bulkListBtn");
const bulkListActions = document.getElementById("bulkListActions");
const bulkBuyBtn = document.getElementById("bulkBuyBtn");
const bulkTotalPriceEl = document.getElementById("bulkTotalPrice");
const bulkSelectionControls = document.getElementById("bulkSelectionControls"); 
const targetRarityLabel = document.getElementById("targetRarityLabel"); 

if(bulkPriceInp) bulkPriceInp.placeholder = "Qiymət ($)";

const searchInput = document.getElementById("searchInput");
const targetPriceInput = document.getElementById("targetPriceInput"); 
const clearPriceBtn = document.getElementById("clearPriceBtn"); 

const totalVolEl = document.getElementById("totalVol");
const dayVolEl = document.getElementById("dayVol");
const itemsCountEl = document.getElementById("itemsCount");

// ==========================================
// 2. KÖMƏKÇİ FUNKSİYALAR
// ==========================================

function notify(msg, timeout = 4000) {
  if (!noticeDiv) return;
  noticeDiv.textContent = msg;
  noticeDiv.style.transform = "scale(1.05)";
  setTimeout(() => noticeDiv.style.transform = "scale(1)", 200);

  if (timeout) {
      setTimeout(() => { 
          if (noticeDiv.textContent === msg) noticeDiv.textContent = "Marketplace-ə xoş gəldiniz"; 
      }, timeout);
  }
}

async function fetchApePrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=apecoin&vs_currencies=usd');
        const data = await response.json();
        if (data.apecoin && data.apecoin.usd) {
            apePriceUsd = data.apecoin.usd;
            console.log("Current APE Price: $" + apePriceUsd);
        }
    } catch (error) {
        console.warn("APE qiyməti alına bilmədi.");
    }
}

function cleanOrder(orderData) {
  try {
    const order = orderData.order || orderData;
    const { parameters, signature } = order;
    if (!parameters) return null;
    const toStr = (val) => {
        if (val === undefined || val === null) return "0";
        if (typeof val === "object" && val.hex) return BigInt(val.hex).toString();
        return val.toString();
    };
    return {
      parameters: {
        offerer: parameters.offerer,
        zone: parameters.zone,
        offer: parameters.offer.map(item => ({
          itemType: Number(item.itemType), token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount), endAmount: toStr(item.endAmount)
        })),
        consideration: parameters.consideration.map(item => ({
          itemType: Number(item.itemType), token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount), endAmount: toStr(item.endAmount), recipient: item.recipient
        })),
        orderType: Number(parameters.orderType), startTime: toStr(parameters.startTime),
        endTime: toStr(parameters.endTime), zoneHash: parameters.zoneHash,
        salt: toStr(parameters.salt), conduitKey: parameters.conduitKey,
        counter: toStr(parameters.counter),
        totalOriginalConsiderationItems: Number(parameters.totalOriginalConsiderationItems || parameters.consideration.length)
      }, signature: signature
    };
  } catch (e) { return null; }
}

function orderToJsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === "object") {
      if (ethers.BigNumber.isBigNumber(v)) return v.toString();
      if (v._hex) return ethers.BigNumber.from(v._hex).toString();
    }
    return v;
  }));
}

// ==========================================
// 3. FILTR VƏ SIRALAMA MƏNTİQİ
// ==========================================

window.setFilter = (filterType) => {
    currentFilter = filterType;
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    const activeBtn = Array.from(buttons).find(b => b.getAttribute('onclick').includes(filterType));
    if(activeBtn) activeBtn.classList.add('active');

    applyFilters();
};

window.handleSortChange = (val) => {
    currentSort = val;
    applyFilters();
};

function updateFilterCounts() {
    if(!countAllEl) return;

    const total = allNFTs.length;
    const listed = allNFTs.filter(n => parseFloat(n.price) > 0).length;
    const sold = allNFTs.filter(n => parseFloat(n.last_sale_price) > 0).length;
    const unlisted = allNFTs.filter(n => {
        const p = parseFloat(n.price || 0);
        const ls = parseFloat(n.last_sale_price || 0);
        return p === 0 && ls === 0;
    }).length;

    countAllEl.textContent = total;
    countListedEl.textContent = listed;
    countUnlistedEl.textContent = unlisted;
    countSoldEl.textContent = sold;
}

function applyFilters() {
    const query = searchInput.value.toLowerCase();
    
    // 1. Filtrasiya
    let filtered = allNFTs.filter(nft => {
        const name = (nft.name || "").toLowerCase();
        const tid = (nft.tokenid ?? nft.tokenId).toString();
        
        // Axtarış Filteri
        const matchesSearch = name.includes(query) || tid.includes(query);
        if(!matchesSearch) return false;

        const price = parseFloat(nft.price || 0);
        const lastSale = parseFloat(nft.last_sale_price || 0);

        // Status Filteri
        if (currentFilter === 'listed' && price <= 0) return false;
        if (currentFilter === 'unlisted' && (price > 0 || lastSale > 0)) return false;
        if (currentFilter === 'sold' && lastSale <= 0) return false;

        // YENI: PRICE TARGET FILTER (-+10%)
        if (targetPriceFilter !== null && apePriceUsd > 0) {
            if (price <= 0) return false;

            const nftPriceInUsd = price * apePriceUsd;
            const minPrice = targetPriceFilter * 0.9; // -10%
            const maxPrice = targetPriceFilter * 1.1; // +10%

            if (nftPriceInUsd < minPrice || nftPriceInUsd > maxPrice) {
                return false;
            }
        }
        
        return true; 
    });

    // 2. SIRALAMA
    filtered.sort((a, b) => {
        const priceA = parseFloat(a.price || 0);
        const priceB = parseFloat(b.price || 0);
        const idA = parseInt(a.tokenid ?? a.tokenId);
        const idB = parseInt(b.tokenid ?? b.tokenId);

        const rankA = (rarityData[idA] && rarityData[idA].rank) ? rarityData[idA].rank : 99999;
        const rankB = (rarityData[idB] && rarityData[idB].rank) ? rarityData[idB].rank : 99999;

        switch (currentSort) {
            case 'price_asc': 
                if (priceA > 0 && priceB === 0) return -1;
                if (priceA === 0 && priceB > 0) return 1;
                if (priceA > 0 && priceB > 0) return priceA - priceB;
                return idA - idB;

            case 'price_desc': 
                if (priceA > 0 && priceB === 0) return -1;
                if (priceA === 0 && priceB > 0) return 1;
                return priceB - priceA;

            case 'rarity_asc': return rankA - rankB;
            case 'rarity_desc': return rankB - rankA;
            case 'id_asc': return idA - idB;
            default: return idA - idB;
        }
    });

    renderNFTs(filtered);
}

// YENI: Price Input Event Listeners
if(targetPriceInput) {
    targetPriceInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (val && val > 0) {
            targetPriceFilter = val;
            clearPriceBtn.style.display = 'flex';
        } else {
            targetPriceFilter = null;
            clearPriceBtn.style.display = 'none';
        }
        applyFilters();
    });
}

if(clearPriceBtn) {
    clearPriceBtn.onclick = () => {
        targetPriceInput.value = "";
        targetPriceFilter = null;
        clearPriceBtn.style.display = 'none';
        applyFilters();
    };
}

// ==========================================
// 4. CÜZDAN QOŞULMASI
// ==========================================

function handleDisconnect() {
  provider = null;
  signer = null;
  seaport = null;
  userAddress = null;

  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  
  // Wallet Profile Button gizlət
  const walletProfileBtn = document.getElementById("walletProfileBtn");
  if(walletProfileBtn) walletProfileBtn.style.display = "none";
  document.getElementById('walletModalOverlay').style.display = "none";

  addrSpan.textContent = "";
  addrSpan.style.display = "none";
  
  cancelBulk();
  applyFilters(); 
  notify("Çıxış edildi");
}

async function setupUserSession(account) {
    userAddress = account.toLowerCase();

    if (window.ethereum) {
        provider = new ethers.providers.Web3Provider(window.ethereum, "any");
        signer = provider.getSigner();
        seaport = new Seaport(signer, { 
            overrides: { contractAddress: SEAPORT_ADDRESS, defaultConduitKey: ZERO_BYTES32 } 
        });
    }

    addrSpan.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    addrSpan.style.display = "inline-block";
    notify("Cüzdan qoşuldu!");
    
    connectBtn.style.display = "none";
    
    // Wallet Profile Button göstər
    const walletProfileBtn = document.getElementById("walletProfileBtn");
    if(walletProfileBtn) {
        walletProfileBtn.style.display = "inline-flex";
        walletProfileBtn.innerText = `Cüzdanım 💰`;
    }

    disconnectBtn.style.display = "inline-block";
    
    cancelBulk();
    applyFilters();
    setTimeout(updateWalletStats, 500); 
}

async function handleAccountsChanged(accounts) {
  handleDisconnect();
}

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    
    const { chainId } = await provider.getNetwork();
    if (chainId !== APECHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: APECHAIN_ID_HEX, chainName: "ApeChain Mainnet",
            nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
            rpcUrls: [APECHAIN_RPC],
            blockExplorerUrls: ["https://apescan.io"],
          }],
        });
        provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      } catch (e) { return alert("ApeChain şəbəkəsinə keçilmədi."); }
    }

    const accounts = await provider.send("eth_requestAccounts", []);
    
    if (accounts.length > 0) {
        await setupUserSession(accounts[0]);
    }

    if (signer && !signer.signTypedData) {
        signer.signTypedData = async (domain, types, value) => {
            const typesCopy = { ...types }; delete typesCopy.EIP712Domain; 
            return await signer._signTypedData(domain, typesCopy, value);
        };
    }

    window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
    window.ethereum.on("accountsChanged", handleAccountsChanged);

  } catch (err) { 
      console.error(err);
      if (err.code !== 4001) { 
          alert("Connect xətası: " + err.message); 
      }
  }
}

disconnectBtn.onclick = handleDisconnect;
connectBtn.onclick = connectWallet;

async function ensureWalletConnection() {
    if (signer && seaport) return true;
    if (window.ethereum && window.ethereum.selectedAddress) {
        try {
            provider = new ethers.providers.Web3Provider(window.ethereum, "any");
            signer = provider.getSigner();
            seaport = new Seaport(signer, { 
                overrides: { contractAddress: SEAPORT_ADDRESS, defaultConduitKey: ZERO_BYTES32 } 
            });
             if (signer && !signer.signTypedData) {
                signer.signTypedData = async (domain, types, value) => {
                    const typesCopy = { ...types }; delete typesCopy.EIP712Domain; 
                    return await signer._signTypedData(domain, typesCopy, value);
                };
            }
            return true;
        } catch (e) {
            console.error("Bərpa xətası:", e);
            return false;
        }
    }
    return false;
}

// ==========================================
// 5. DATA YÜKLƏMƏ
// ==========================================

async function fetchStats() {
    if (!totalVolEl || !dayVolEl) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/stats`);
        const data = await res.json();
        if(data.success) {
            const fmt = (val) => parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            totalVolEl.innerText = `${fmt(data.totalVolume)} APE`;
            dayVolEl.innerText = `${fmt(data.dayVolume)} APE`;
        }
    } catch(e) { console.error("Stats Error:", e); }
}

async function loadData() {
  selectedTokens.clear();
  updateBulkUI();
  fetchStats();
  
  await fetchApePrice();

  try {
      const rRes = await fetch('/rarity_data.json');
      if (rRes.ok) {
          rarityData = await rRes.json();
          console.log("✅ Rarity Data Loaded.");
      } else {
          console.warn("⚠️ rarity_data.json tapılmadı.");
      }
  } catch(e) {
      console.error("Rarity Load Error:", e);
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/nfts`);
    const data = await res.json();
    let rawList = data.nfts || [];

    allNFTs = rawList; 

    updateFilterCounts();
    applyFilters();
  } catch (err) {
    console.error(err);
    marketplaceDiv.innerHTML = "<p style='color:red; text-align:center; grid-column:1/-1;'>Yüklənmə xətası.</p>";
  }
}

// ==========================================
// 6. RENDER (OPTIMIZASIYA + INFINITE SCROLL)
// ==========================================

function createCardElement(nft) {
    const tokenidRaw = (nft.tokenid !== undefined && nft.tokenid !== null) ? nft.tokenid : nft.tokenId;
    if (tokenidRaw === undefined || tokenidRaw === null) return null;
    const tokenid = tokenidRaw.toString(); 

    const name = nft.name || `NFT #${tokenid}`;
    
    let displayPrice = "";
    let priceVal = 0;
    let isListed = false;

    if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        isListed = true;
        let usdText = "";
        if (apePriceUsd > 0) {
            const totalUsd = (priceVal * apePriceUsd).toFixed(2);
            usdText = `<span style="font-size:12px; color:#5d6b79; margin-left:5px; font-weight:500;">($${totalUsd})</span>`;
        }
        displayPrice = `${priceVal.toFixed(2)} APE ${usdText}`;
    }

    let lastSoldHTML = "";
    if (!isListed && nft.last_sale_price && parseFloat(nft.last_sale_price) > 0) {
        const lsPrice = parseFloat(nft.last_sale_price);
        let lsUsd = "";
        if (apePriceUsd > 0) lsUsd = `($${(lsPrice * apePriceUsd).toFixed(2)})`;
        lastSoldHTML = `<div style="font-size:12px; color:#888; margin-top:4px; font-weight:500;">Son satış: ${lsPrice.toFixed(2)} APE ${lsUsd}</div>`;
    }

    let canManage = false;
    let canSelect = false;

    if (userAddress) {
        if (nft.seller_address && nft.seller_address.toLowerCase() === userAddress) {
            canManage = true; canSelect = true;
        }
        else if (nft.buyer_address && nft.buyer_address.toLowerCase() === userAddress) {
            canManage = true; canSelect = true;
        } else {
            if(isListed) canSelect = true;
        }
    }

    const rInfo = rarityData[tokenid] || { rank: '?', type: 'common', traits: [] };
    const rankLabel = rInfo.rank !== '?' ? ` #${rInfo.rank}` : `#${tokenid}`;
    
    let icon = ""; 

    let attrHTML = "";
    if (rInfo.traits && rInfo.traits.length > 0) {
        const sortedTraits = rInfo.traits.sort((a,b) => b.score - a.score);
        
        attrHTML = `<div class="attributes-grid">`;
        sortedTraits.forEach(t => {
            const pctVal = parseFloat(t.percent);
            let pctColor = "#64748b"; 
            
            if(pctVal < 2) pctColor = "#f97316"; 
            else if(pctVal < 10) pctColor = "#a855f7"; 
            else if(pctVal < 25) pctColor = "#3b82f6"; 

            const safeType = t.trait_type.replace(/'/g, "\\'");
            const safeValue = t.value.replace(/'/g, "\\'");
            const safePercent = t.percent;

            attrHTML += `
                <div class="trait-box" onclick="window.filterByAttribute('${safeType}', '${safeValue}', '${safePercent}', event)">
                    <div class="trait-type">${t.trait_type}</div>
                    <div class="trait-value" title="${t.value}">${t.value}</div>
                    <div style="font-size:9px; color:${pctColor}; text-align:right;">${t.percent}</div>
                </div>
            `;
        });
        attrHTML += `</div>`;
    } else {
        attrHTML = `<div style="height:40px; display:flex; align-items:center; justify-content:center; color:#ccc; font-size:10px;">-</div>`;
    }

    const card = document.createElement("div");
    card.className = `nft-card ${rInfo.type}`;
    card.id = `card-${tokenid}`; 
    card.style.height = "auto";
    card.style.opacity = "1";
    card.style.transform = "none";
    card.style.animation = "none";

    let checkboxHTML = canSelect ? `<input type="checkbox" class="select-box" data-id="${tokenid}">` : "";

    let actionsHTML = "";
    if (isListed) {
        if (canManage) {
            actionsHTML = `
                <input type="number" placeholder="Yeni Qiymət ($)" class="mini-input price-input" step="0.01">
                <button class="action-btn btn-list update-btn" style="margin-top:8px;">Yenilə</button>
            `;
        } else {
            let btnText = `${priceVal.toFixed(2)} APE`; 
            actionsHTML = `<button class="action-btn btn-buy buy-btn">Satın Al ${btnText}</button>`;
        }
    } else {
        if (canManage) {
            actionsHTML = `
                ${lastSoldHTML}
                <input type="number" placeholder="Qiymət ($)" class="mini-input price-input" step="0.01">
                <button class="action-btn btn-list list-btn" style="margin-top:8px;">Satışa Qoy</button>
            `;
        } else {
             actionsHTML = `
                ${lastSoldHTML}
                <div style="font-size:13px; color:#999; text-align:center; padding:10px;">Satışda deyil</div>
             `;
        }
    }

    card.innerHTML = `
        <div class="rarity-badge ${rInfo.type}">
            <i>${icon}</i> <span>${rankLabel}</span>
        </div>
        ${checkboxHTML}
        <div class="card-content">
            <div class="card-title" title="${name}">${name}</div>
            
            <button class="toggle-attr-btn" onclick="window.toggleAttributes('${tokenid}', this, event)">
                <span>Atributlar</span> <span>▼</span>
            </button>
            
            <div id="attr-box-${tokenid}" class="hidden-attrs">
                ${attrHTML}
            </div>

            <div style="margin-top:auto; padding-top:5px;">
                 ${displayPrice && !canManage ? `<div class="price-val" style="display:flex; align-items:center; flex-wrap:wrap;">${displayPrice}</div>` : ``}
            </div>
            
            <div class="card-actions" style="flex-direction:column; gap:4px;">
                ${actionsHTML}
            </div>
        </div>
    `;

    const chk = card.querySelector(".select-box");
    if (chk) {
        chk.checked = selectedTokens.has(tokenid);
        chk.onchange = (e) => {
            if (e.target.checked) selectedTokens.add(tokenid);
            else selectedTokens.delete(tokenid);
            updateBulkUI();
        };
    }

    if (isListed && !canManage) {
        const btn = card.querySelector(".buy-btn");
        if(btn) btn.onclick = async () => await buyNFT(nft);
    } else {
        const btn = card.querySelector(".list-btn") || card.querySelector(".update-btn");
        if(btn) {
            btn.onclick = async () => {
                const priceInput = card.querySelector(".price-input");
                let usdInp = priceInput.value;
                if(usdInp) usdInp = usdInp.trim();

                if(!usdInp || isNaN(usdInp) || parseFloat(usdInp) <= 0) return notify("Düzgün dollar qiyməti yazın!");
                
                if (!apePriceUsd || apePriceUsd <= 0) {
                    await fetchApePrice(); 
                    if (!apePriceUsd || apePriceUsd <= 0) return alert("APE məzənnəsi alınmadı. Yeniləyin.");
                }

                let apeAmount = parseFloat(usdInp) / apePriceUsd;
                apeAmount = parseFloat(apeAmount.toFixed(2));

                if(apeAmount <= 0) return alert("Qiymət çox aşağıdır, APE miqdarı 0.00 olur.");

                const confirmMsg = `Siz bu NFT-ni $${usdInp} (~${apeAmount.toFixed(2)} APE) qiymətinə qoyursunuz.\nDavam edilsin?`;
                if (!confirm(confirmMsg)) return;

                await listNFT(tokenid, apeAmount);
            };
        }
    }

    return card;
}

function renderNFTs(list) {
    currentFilteredList = list;
    displayedCount = 0;
    
    if (itemsCountEl) itemsCountEl.innerText = list.length;
    marketplaceDiv.innerHTML = "";

    if (list.length === 0) {
        marketplaceDiv.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: #94a3b8; display:flex; flex-direction:column; align-items:center; gap:20px;">
                <div style="font-size: 60px; opacity:0.5;">👻</div>
                <div>
                    <h3 style="margin:0; font-size:20px; color:#64748b;">Heç bir NFT tapılmadı</h3>
                </div>
            </div>
        `;
        return;
    }

    loadMoreNFTs();
}

function loadMoreNFTs() {
    if (isLoadingMore || displayedCount >= currentFilteredList.length) return;

    isLoadingMore = true; 

    const nextCount = Math.min(displayedCount + BATCH_SIZE, currentFilteredList.length);
    const slice = currentFilteredList.slice(displayedCount, nextCount);

    const fragment = document.createDocumentFragment();

    slice.forEach((nft) => {
        const cardElement = createCardElement(nft);
        if(cardElement) {
            cardElement.style.animation = "fadeIn 0.4s ease forwards";
            fragment.appendChild(cardElement);
        }
    });

    marketplaceDiv.appendChild(fragment);
    displayedCount = nextCount;

    setTimeout(() => {
        isLoadingMore = false;
    }, 100);
}

// SCROLL LISTENER
window.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 300) {
        loadMoreNFTs();
    }
});


function refreshSingleCard(tokenid) {
    const nftData = allNFTs.find(n => n.tokenid == tokenid);
    if (!nftData) return;
    
    updateFilterCounts(); 

    const oldCard = document.getElementById(`card-${tokenid}`);
    
    const price = parseFloat(nftData.price || 0);
    const lastSale = parseFloat(nftData.last_sale_price || 0);
    let shouldShow = true;
    if (currentFilter === 'listed' && price === 0) shouldShow = false;
    if (currentFilter === 'unlisted' && (price > 0 || lastSale > 0)) shouldShow = false;
    if (currentFilter === 'sold' && lastSale === 0) shouldShow = false;
    
    if (oldCard && !shouldShow) {
        oldCard.remove();
        return;
    }

    const newCard = createCardElement(nftData);
    if (oldCard && newCard && shouldShow) {
        oldCard.replaceWith(newCard);
    }
}

if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
}

// ==========================================
// 7. TOPLU UI & LOGIC (YENILƏNMİŞ)
// ==========================================

function updateBulkUI() {
    if (selectedTokens.size > 0) {
        bulkBar.classList.add("active");
        bulkCount.textContent = `${selectedTokens.size} NFT seçildi`;

        const firstTokenId = Array.from(selectedTokens)[0]; 
        const firstNFT = allNFTs.find(n => n.tokenid == firstTokenId);
        
        let showControls = false;
        let rarityType = "Common";

        if (firstNFT && userAddress && (
            (firstNFT.seller_address && firstNFT.seller_address.toLowerCase() === userAddress) ||
            (!firstNFT.seller_address && firstNFT.buyer_address && firstNFT.buyer_address.toLowerCase() === userAddress)
           )) {
            showControls = true;
            if(rarityData[firstTokenId]) {
                rarityType = rarityData[firstTokenId].type; 
            }
        }

        if (showControls && bulkSelectionControls) {
            bulkSelectionControls.style.display = "flex";
            if(targetRarityLabel) {
                targetRarityLabel.innerText = rarityType.charAt(0).toUpperCase() + rarityType.slice(1);
                targetRarityLabel.style.color = `var(--${rarityType}-color)`; 
            }
        } else if (bulkSelectionControls) {
            bulkSelectionControls.style.display = "none";
        }

        let totalCostApe = 0;
        let allListed = true;
        let validSelection = false;

        selectedTokens.forEach(tid => {
            const nft = allNFTs.find(n => n.tokenid == tid);
            if (nft) {
                validSelection = true;
                const price = parseFloat(nft.price || 0);
                const isOwner = (nft.seller_address && nft.seller_address.toLowerCase() === userAddress);
                
                if (price > 0 && !isOwner) {
                    totalCostApe += price;
                } else {
                    allListed = false; 
                }
            }
        });

        if (allListed && validSelection && totalCostApe > 0) {
            // BUY MODE
            bulkListActions.style.display = "none";
            bulkBuyBtn.style.display = "inline-block";
            if(bulkSelectionControls) bulkSelectionControls.style.display = "none"; 
            
            let totalUsdText = "";
            if (apePriceUsd > 0) {
                totalUsdText = ` ($${(totalCostApe * apePriceUsd).toFixed(2)})`;
            }

            bulkTotalPriceEl.innerHTML = `${totalCostApe.toFixed(2)} ${totalUsdText}`;
        } else {
            // LIST MODE
            bulkListActions.style.display = "flex";
            bulkBuyBtn.style.display = "none";
        }
    } else {
        bulkBar.classList.remove("active");
    }
}

window.modifySelection = (amount) => {
    if (selectedTokens.size === 0) return;

    const firstTokenId = Array.from(selectedTokens)[0];
    const rInfo = rarityData[firstTokenId];
    if (!rInfo) return;

    const targetRarity = rInfo.type;

    const candidates = allNFTs.filter(n => {
        let isMine = false;
        if (n.seller_address && n.seller_address.toLowerCase() === userAddress) isMine = true;
        if (!n.seller_address && n.buyer_address && n.buyer_address.toLowerCase() === userAddress) isMine = true;
        
        const tokenRarity = rarityData[n.tokenid] ? rarityData[n.tokenid].type : 'common';
        return isMine && tokenRarity === targetRarity;
    });

    if (amount > 0) {
        let addedCount = 0;
        for (const nft of candidates) {
            if (addedCount >= amount) break;
            const tid = nft.tokenid.toString();
            
            if (!selectedTokens.has(tid)) {
                selectedTokens.add(tid);
                addedCount++;
                const chk = document.querySelector(`.select-box[data-id="${tid}"]`);
                if(chk) chk.checked = true;
            }
        }
        if(addedCount > 0) notify(`${addedCount} ədəd ${targetRarity} əlavə edildi`);
        else notify(`Daha əlavə ediləcək ${targetRarity} yoxdur`);

    } else {
        let removeCount = Math.abs(amount);
        let removed = 0;
        
        const currentSelectedCandidates = Array.from(selectedTokens).filter(tid => {
            const tr = rarityData[tid] ? rarityData[tid].type : 'common';
            return tr === targetRarity;
        });

        for (let i = currentSelectedCandidates.length - 1; i >= 0; i--) {
            if (removed >= removeCount) break;
            const tid = currentSelectedCandidates[i];
            
            selectedTokens.delete(tid);
            const chk = document.querySelector(`.select-box[data-id="${tid}"]`);
            if(chk) chk.checked = false;
            removed++;
        }
        notify(`${removed} ədəd çıxarıldı`);
    }

    updateBulkUI();
};

window.cancelBulk = () => {
    selectedTokens.clear();
    document.querySelectorAll(".select-box").forEach(b => b.checked = false);
    updateBulkUI();
};

if(bulkListBtn) {
    bulkListBtn.onclick = async () => {
        let usdVal = bulkPriceInp.value;
        if(usdVal) usdVal = usdVal.trim();
        
        if (!usdVal || isNaN(usdVal) || parseFloat(usdVal) <= 0) return alert("Dollar qiyməti yazın.");
        
        if (!apePriceUsd || apePriceUsd <= 0) {
             await fetchApePrice();
             if (!apePriceUsd || apePriceUsd <= 0) return alert("Məzənnə xətası. Yeniləyin.");
        }

        let apeAmount = parseFloat(usdVal) / apePriceUsd;
        apeAmount = parseFloat(apeAmount.toFixed(2)); 

        if(apeAmount <= 0) return alert("Qiymət çox aşağıdır, APE miqdarı 0.00 olur.");

        const confirmMsg = `Siz seçilən NFT-ləri hər biri $${usdVal} (~${apeAmount.toFixed(2)} APE) qiymətinə qoyursunuz.\nDavam?`;
        if(!confirm(confirmMsg)) return;

        await bulkListNFTs(Array.from(selectedTokens), apeAmount);
    };
}

if(bulkBuyBtn) {
    bulkBuyBtn.onclick = async () => {
        await bulkBuyNFTs(Array.from(selectedTokens));
    };
}

// ==========================================
// 8. LISTING FUNCTIONS
// ==========================================

async function listNFT(tokenid, priceInApe) {
  if (tokenid === undefined || tokenid === null) return alert("Token ID xətası.");
  await bulkListNFTs([tokenid], priceInApe);
}

async function bulkListNFTs(tokenIds, priceInApe) {
    await ensureWalletConnection();
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb! Zəhmət olmasa 'Connect Wallet' düyməsinə basın.");
    
    let priceWeiString;
    try {
        const safePriceStr = priceInApe.toFixed(18); 
        priceWeiString = ethers.utils.parseEther(safePriceStr).toString();
    } catch (e) { return alert(`Qiymət xətası: ${e.message}`); }

    const cleanTokenIds = tokenIds.map(t => String(t));
    const seller = await signer.getAddress();

    try {
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
            ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
        
        if (!(await nftContract.isApprovedForAll(seller, SEAPORT_ADDRESS))) {
            notify("Satış kontraktı təsdiq olunur...");
            const tx = await nftContract.setApprovalForAll(SEAPORT_ADDRESS, true);
            await tx.wait();
            notify("Təsdiqləndi!");
        }
    } catch (e) { return alert("Approve xətası: " + e.message); }

    notify(`${cleanTokenIds.length} NFT orderi imzalanır...`);

    try {
        const startTimeVal = Math.floor(Date.now()/1000).toString(); 
        const endTimeVal = (Math.floor(Date.now()/1000) + 15552000).toString(); 

        const orderInputs = cleanTokenIds.map(tokenStr => {
            return {
                orderType: OrderType.FULL_OPEN, zone: ZERO_ADDRESS, zoneHash: ZERO_BYTES32, conduitKey: ZERO_BYTES32, 
                offer: [{ itemType: ItemType.ERC721, token: NFT_CONTRACT_ADDRESS, identifier: tokenStr, amount: "1" }],
                consideration: [{ itemType: ItemType.NATIVE, token: ZERO_ADDRESS, identifier: "0", amount: priceWeiString, recipient: seller }],
                startTime: startTimeVal, endTime: endTimeVal,
            };
        });

        notify("Zəhmət olmasa cüzdanda imzalayın...");
        const { executeAllActions } = await seaport.createBulkOrders(orderInputs, seller);
        const signedOrders = await executeAllActions(); 

        notify("İmza alındı! UI yenilənir...");

        for (const order of signedOrders) {
            const offerItem = order.parameters.offer[0];
            const tokenStr = offerItem.identifierOrCriteria;

            await fetch(`${BACKEND_URL}/api/order`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tokenid: tokenStr,
                    price: String(priceInApe), 
                    seller_address: seller,
                    seaport_order: orderToJsonSafe(order),
                    order_hash: seaport.getOrderHash(order.parameters),
                    status: "active"
                }),
            });

            const nftIndex = allNFTs.findIndex(n => n.tokenid == tokenStr);
            if (nftIndex !== -1) {
                allNFTs[nftIndex].price = priceInApe;
                allNFTs[nftIndex].seller_address = seller.toLowerCase();
                allNFTs[nftIndex].seaport_order = orderToJsonSafe(order); 
                allNFTs[nftIndex].buyer_address = null;
            }
            refreshSingleCard(tokenStr);
        }
        
        cancelBulk();
        notify("Uğurla listələndi!");

    } catch (err) {
        console.error("List Error:", err);
        alert("Satış xətası: " + (err.message || err));
    }
}

// ==========================================
// 9. BUY FUNCTIONS
// ==========================================

async function buyNFT(nftRecord) {
    selectedTokens.clear();
    selectedTokens.add(nftRecord.tokenid.toString());
    await bulkBuyNFTs([nftRecord.tokenid.toString()]);
}

async function bulkBuyNFTs(tokenIds) {
    await ensureWalletConnection();
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb! Zəhmət olmasa 'Connect Wallet' düyməsinə basın.");
    
    const buyerAddress = await signer.getAddress();
    const fulfillOrderDetails = [];
    let totalValue = ethers.BigNumber.from(0);

    for (const tid of tokenIds) {
        const nftRecord = allNFTs.find(n => n.tokenid == tid);
        if (!nftRecord || !nftRecord.seaport_order) continue;

        if (nftRecord.seller_address && nftRecord.seller_address.toLowerCase() === buyerAddress.toLowerCase()) {
            return alert(`NFT #${tid} sizin özünüzə aiddir, onu ala bilməzsiniz!`);
        }

        let rawOrder = nftRecord.seaport_order;
        if (typeof rawOrder === "string") { try{ rawOrder = JSON.parse(rawOrder); }catch(e){} }
        
        const cleanOrd = cleanOrder(rawOrder);
        if (cleanOrd) {
            fulfillOrderDetails.push({ order: cleanOrd });
            cleanOrd.parameters.consideration.forEach(c => {
                 if (Number(c.itemType) === 0) totalValue = totalValue.add(ethers.BigNumber.from(c.startAmount));
            });
        }
    }

    if (fulfillOrderDetails.length === 0) return alert("Alınacaq uyğun order tapılmadı.");

    notify(`${fulfillOrderDetails.length} NFT üçün toplu alış hazırlanır...`);

    try {
        const { actions } = await seaport.fulfillOrders({
            fulfillOrderDetails: fulfillOrderDetails,
            accountAddress: buyerAddress,
            conduitKey: ZERO_BYTES32
        });

        const txRequest = await actions[0].transactionMethods.buildTransaction();

        if (txRequest.value) {
            const valBN = ethers.BigNumber.from(txRequest.value);
            if (valBN.gt(totalValue)) totalValue = valBN;
        }

        notify("Metamask-da təsdiqləyin...");
        const tx = await signer.sendTransaction({
            to: txRequest.to, data: txRequest.data, value: totalValue, 
            gasLimit: 300000 * fulfillOrderDetails.length 
        });

        notify("Blokçeyndə təsdiqlənir...");
        await tx.wait();

        notify("Baza yenilənir...");
        
        for (const item of fulfillOrderDetails) {
            const tokenIdentifier = item.order.parameters.offer[0].identifierOrCriteria;
            const nftData = allNFTs.find(n => n.tokenid == tokenIdentifier);
            
            if (nftData) {
                 await fetch(`${BACKEND_URL}/api/buy`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        tokenid: tokenIdentifier, 
                        order_hash: nftData.order_hash, 
                        buyer_address: buyerAddress,
                        price: nftData.price, 
                        seller: nftData.seller_address 
                    }),
                });
                
                const idx = allNFTs.findIndex(n => n.tokenid == tokenIdentifier);
                if (idx !== -1) {
                    allNFTs[idx].last_sale_price = allNFTs[idx].price; 
                    allNFTs[idx].price = 0;
                    allNFTs[idx].seller_address = null;
                    allNFTs[idx].buyer_address = buyerAddress.toLowerCase();
                    allNFTs[idx].seaport_order = null;
                }
                refreshSingleCard(tokenIdentifier);
            }
        }
        
        cancelBulk();
        fetchStats();
        notify("Toplu alış uğurlu oldu!");

    } catch (err) {
        console.error("Bulk Buy Error:", err);
        if (err.message && err.message.includes("insufficient funds")) alert("Balansınızda kifayət qədər APE yoxdur.");
        else alert("Alış xətası: " + (err.message || err));
    }
}

// ==========================================
// 10. NEW FUNCTIONS (Attribute Logic)
// ==========================================

window.toggleAttributes = (id, btn, event) => {
    if(event) event.stopPropagation();

    const box = document.getElementById(`attr-box-${id}`);
    const icon = btn.querySelector("span:last-child");

    if (box.style.display === "block") {
        box.style.display = "none";
        icon.innerText = "▼";
        btn.style.borderColor = "var(--border-color)";
        btn.style.color = "var(--text-secondary)";
    } else {
        box.style.display = "block";
        icon.innerText = "▲";
        btn.style.borderColor = "var(--accent-color)";
        btn.style.color = "var(--accent-color)";
    }
};

window.filterByAttribute = (type, value, percent, event) => {
    if(event) event.stopPropagation();

    const searchInput = document.getElementById("searchInput");
    if(searchInput) {
        searchInput.value = value; 
        applyFilters(); 
    }

    notify(`Filtrləndi: ${type} - ${value} (${percent})`);
    window.scrollTo({ top: 100, behavior: 'smooth' });
};

// ==========================================
// 11. CÜZDAN DASHBOARD (YENİ)
// ==========================================

window.toggleWalletModal = async () => {
    const modal = document.getElementById('walletModalOverlay');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        if(!userAddress) return alert("Əvvəlcə cüzdanı qoşun!");
        await updateWalletStats();
        modal.style.display = 'flex';
    }
};

window.switchTab = (tabName) => {
    document.querySelectorAll('.wd-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.wd-content').forEach(c => c.classList.remove('active'));
    
    const activeBtn = document.querySelector(`.wd-tab-btn[onclick="switchTab('${tabName}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    
    document.getElementById(`tab-${tabName}`).classList.add('active');
};

async function updateWalletStats() {
    if(!provider || !userAddress) return;

    try {
        const balanceBN = await provider.getBalance(userAddress);
        const balanceEth = ethers.utils.formatEther(balanceBN);
        const formatBal = parseFloat(balanceEth).toFixed(4);
        
        document.getElementById('walletBalance').innerText = `${formatBal} APE`;
    } catch (e) {
        console.error("Balans xətası:", e);
    }

    const shortAddr = `${userAddress.slice(0,6)}...${userAddress.slice(-4)}`;
    document.getElementById('walletAddressMini').innerText = `${shortAddr} 📋`;
    document.getElementById('fullWalletAddr').innerText = userAddress;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${userAddress}`;
    document.getElementById('qrImage').src = qrUrl;
}

window.sendCoin = async () => {
    const toAddr = document.getElementById('sendToAddr').value;
    const amount = document.getElementById('sendAmount').value;

    if(!ethers.utils.isAddress(toAddr)) return notify("Yanlış adres formatı!");
    if(!amount || parseFloat(amount) <= 0) return notify("Yanlış məbləğ!");

    try {
        notify("Tranzaksiya hazırlanır...");
        const tx = await signer.sendTransaction({
            to: toAddr,
            value: ethers.utils.parseEther(amount)
        });
        
        notify("Təsdiqlənir... Gözləyin");
        await tx.wait();
        
        notify("Uğurla göndərildi! 🚀");
        updateWalletStats(); 
        
        document.getElementById('sendToAddr').value = "";
        document.getElementById('sendAmount').value = "";
        
    } catch (error) {
        console.error(error);
        if(error.code === 'INSUFFICIENT_FUNDS') notify("Balans kifayət etmir!");
        else notify("Xəta baş verdi: " + error.message.slice(0, 20));
    }
};

window.copyAddress = () => {
    if(userAddress) {
        navigator.clipboard.writeText(userAddress);
        notify("Adres kopyalandı! ✅");
    }
};

// Initial Load
loadData();
window.loadNFTs = loadData; 
