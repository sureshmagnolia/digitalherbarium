document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. DUMMY DATABASE (Simulating Firebase) ---
    // In the future, we will replace this array with: 
    // const specimens = await firebase.firestore().collection('specimens').get();
    const mockData = [
        {
            id: "GVC-2025-001",
            scientificName: "Tectona grandis",
            author: "L.f.",
            family: "Lamiaceae",
            commonName: "Teak",
            collector: "Dr. Suresh V",
            location: "Silent Valley",
            date: "2025-10-12",
            image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Tectona_grandis_MHNT.jpg/640px-Tectona_grandis_MHNT.jpg" 
        },
        {
            id: "GVC-2025-002",
            scientificName: "Mangifera indica",
            author: "L.",
            family: "Anacardiaceae",
            commonName: "Mango",
            collector: "Reshmi K",
            location: "College Campus",
            date: "2025-11-05",
            image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Mangifera_indica_-_Köhler–s_Medizinal-Pflanzen-093.jpg/433px-Mangifera_indica_-_Köhler–s_Medizinal-Pflanzen-093.jpg"
        },
        {
            id: "GVC-2025-003",
            scientificName: "Hibiscus rosa-sinensis",
            author: "L.",
            family: "Malvaceae",
            commonName: "China Rose",
            collector: "Student Batch A",
            location: "Botany Garden",
            date: "2025-09-20",
            image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Hibiscus_rosa-sinensis_L._(AM_AK333282-1).jpg/640px-Hibiscus_rosa-sinensis_L._(AM_AK333282-1).jpg"
        }
    ];

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
    renderCards(mockData);
    populateFilters(mockData);

    // --- 2. SEARCH & FILTER LOGIC ---
    function filterData() {
        const query = searchInput.value.toLowerCase();
        const family = familyFilter.value;
        const location = locFilter.value;

        const filtered = mockData.filter(item => {
            // Text Search (Checks Name, ID, Collector)
            const matchesText = (
                item.scientificName.toLowerCase().includes(query) ||
                item.commonName.toLowerCase().includes(query) ||
                item.id.toLowerCase().includes(query) ||
                item.collector.toLowerCase().includes(query)
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
        grid.innerHTML = ''; // Clear existing
        resultCount.textContent = `Showing ${data.length} specimen${data.length !== 1 ? 's' : ''}`;

        if (data.length === 0) {
            noResults.classList.remove('d-none');
            return;
        } else {
            noResults.classList.add('d-none');
        }

        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'col';
            card.innerHTML = `
                <div class="card specimen-card h-100 border-0 shadow-sm" onclick="openModal('${item.id}')">
                    <div class="position-relative">
                        <img src="${item.image}" class="card-img-top" alt="${item.scientificName}" loading="lazy">
                        <span class="position-absolute top-0 end-0 badge bg-dark m-2">${item.family}</span>
                    </div>
                    <div class="card-body">
                        <h6 class="card-title fw-bold text-primary mb-1 fst-italic">${item.scientificName}</h6>
                        <small class="text-muted d-block mb-2">${item.author}</small>
                        
                        <div class="small text-muted border-top pt-2 mt-2">
                            <i class="bi bi-geo-alt-fill text-danger"></i> ${item.location} <br>
                            <i class="bi bi-person-fill"></i> ${item.collector}
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

    // Populate Dropdowns dynamically based on available data
    function populateFilters(data) {
        const families = [...new Set(data.map(i => i.family))].sort();
        const locations = [...new Set(data.map(i => i.location))].sort();

        families.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f; opt.textContent = f;
            familyFilter.appendChild(opt);
        });

        locations.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l; opt.textContent = l;
            locFilter.appendChild(opt);
        });
    }

    // --- 4. MODAL LOGIC (Global Function) ---
    window.openModal = function(id) {
        const item = mockData.find(i => i.id === id);
        if(!item) return;

        // Populate Modal Fields
        document.getElementById('modal-title').textContent = item.scientificName;
        document.getElementById('modal-subtitle').textContent = item.family;
        document.getElementById('modal-img').src = item.image;
        
        document.getElementById('m-genus').textContent = item.scientificName.split(' ')[0];
        document.getElementById('m-species').textContent = item.scientificName.split(' ')[1];
        document.getElementById('m-author').textContent = item.author;
        document.getElementById('m-family').textContent = item.family;
        
        document.getElementById('m-accession').textContent = item.id;
        document.getElementById('m-collector').textContent = item.collector;
        document.getElementById('m-date').textContent = item.date;
        document.getElementById('m-location').textContent = item.location;

        modal.show();
    }
});
