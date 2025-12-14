document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. DATA SOURCE (LocalStorage) ---
    let dbData = [];
    
    try {
        const localData = localStorage.getItem('herbarium_db');
        if (localData) {
            dbData = JSON.parse(localData);
            console.log(`Loaded ${dbData.length} specimens from Local Storage.`);
        }
    } catch (e) {
        console.error("Error loading database:", e);
    }

    // --- DOM ELEMENTS ---
    const grid = document.getElementById('gallery-grid');
    const searchInput = document.getElementById('search-input');
    const familyFilter = document.getElementById('filter-family');
    const locFilter = document.getElementById('filter-location');
    const resultCount = document.getElementById('result-count');
    const noResults = document.getElementById('no-results');
    
    // Modal Elements
    const modalEl = document.getElementById('specimenModal');
    const modal = new bootstrap.Modal(modalEl);

    // --- INITIAL RENDER ---
    renderCards(dbData);
    populateFilters(dbData);

    // --- 2. SEARCH & FILTER LOGIC ---
    function filterData() {
        const query = searchInput.value.toLowerCase().trim();
        const family = familyFilter.value;
        const location = locFilter.value;

        const filtered = dbData.filter(item => {
            // Text Search (Checks Name, ID, Collector, Common Name)
            // We use '|| ""' to prevent errors if a field is missing
            const matchesText = (
                (item.scientificName || "").toLowerCase().includes(query) ||
                (item.commonName || "").toLowerCase().includes(query) ||
                (item.id || "").toLowerCase().includes(query) ||
                (item.collector || "").toLowerCase().includes(query)
            );

            // Dropdown Filters
            const matchesFamily = family === "" || item.family === family;
            const matchesLoc = location === "" || item.location === location;

            return matchesText && matchesFamily && matchesLoc;
        });

        renderCards(filtered);
    }

    // Event Listeners
    searchInput.addEventListener('input', filterData);
    familyFilter.addEventListener('change', filterData);
    locFilter.addEventListener('change', filterData);

    // --- 3. RENDER FUNCTIONS ---
    function renderCards(data) {
        grid.innerHTML = ''; // Clear existing cards
        
        // Update Count
        if(data.length > 0) {
            resultCount.textContent = `Showing ${data.length} specimen${data.length !== 1 ? 's' : ''}`;
            noResults.classList.add('d-none');
        } else {
            resultCount.textContent = "No specimens found";
            noResults.classList.remove('d-none');
            // If DB is totally empty, customize message
            if(dbData.length === 0) {
                document.querySelector('#no-results p').textContent = "The collection is empty. Go to Admin Page to scan plants.";
            }
            return;
        }

        // Generate Cards
        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'col';
            card.innerHTML = `
                <div class="card specimen-card h-100 border-0 shadow-sm" onclick="openModal('${item.id}')">
                    <div class="position-relative">
                        <img src="${item.image}" class="card-img-top" alt="${item.scientificName}" loading="lazy">
                        <span class="position-absolute top-0 end-0 badge bg-dark m-2">${item.family || 'Unassigned'}</span>
                    </div>
                    <div class="card-body">
                        <h6 class="card-title fw-bold text-primary mb-1 fst-italic">${item.scientificName}</h6>
                        <small class="text-muted d-block mb-2">${item.author || ''}</small>
                        
                        <div class="small text-muted border-top pt-2 mt-2">
                            <i class="bi bi-geo-alt-fill text-danger"></i> ${item.location || 'N/A'} <br>
                            <i class="bi bi-person-fill"></i> ${item.collector || 'N/A'}
                        </div>
                    </div>
                    <div class="card-footer bg-white border-0 text-end">
                        <small class="text-muted text-uppercase" style="font-size: 0.75rem;">${item.id}</small>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // Populate Dropdowns dynamically
    function populateFilters(data) {
        // Extract unique Families
        const families = [...new Set(data.map(i => i.family).filter(Boolean))].sort();
        families.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f; opt.textContent = f;
            familyFilter.appendChild(opt);
        });

        // Extract unique Locations
        const locations = [...new Set(data.map(i => i.location).filter(Boolean))].sort();
        locations.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l; opt.textContent = l;
            locFilter.appendChild(opt);
        });
    }

    // --- 4. MODAL LOGIC (Global Function) ---
    window.openModal = function(id) {
        const item = dbData.find(i => i.id === id);
        if(!item) return;

        // Populate Modal Fields
        document.getElementById('modal-title').textContent = item.scientificName;
        document.getElementById('modal-subtitle').textContent = item.family;
        document.getElementById('modal-img').src = item.image;
        
        // Taxonomy
        const nameParts = item.scientificName.split(' ');
        document.getElementById('m-genus').textContent = item.genus || nameParts[0] || '-';
        document.getElementById('m-species').textContent = nameParts[1] || '-';
        document.getElementById('m-author').textContent = item.author || '-';
        document.getElementById('m-family').textContent = item.family || '-';
        
        // Collection Data
        document.getElementById('m-accession').textContent = item.id;
        document.getElementById('m-collector').textContent = item.collector || 'Unknown';
        document.getElementById('m-date').textContent = item.date || 'Unknown';
        document.getElementById('m-location').textContent = item.location || 'Unknown';

        // Show Modal
        modal.show();
    }
});
