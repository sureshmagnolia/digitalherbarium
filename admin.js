document.addEventListener('DOMContentLoaded', () => {

    // --- DOM ELEMENTS ---
    const video = document.getElementById('video-feed');
    const captureBtn = document.getElementById('btn-capture');
    const scanBarcodeBtn = document.getElementById('btn-scan-barcode');
    const toggleCameraBtn = document.getElementById('btn-toggle-camera');
    const saveLocalBtn = document.getElementById('btn-save-local');
    
    // UI Containers
    const scannerContainer = document.getElementById('scanner-container');
    const previewContainer = document.getElementById('image-preview-container');
    const capturedImage = document.getElementById('captured-image');
    const localDbBody = document.getElementById('local-db-body');
    
    // Inputs
    const inputs = {
        accession: document.getElementById('accession-number'),
        binomial: document.getElementById('binomial-input'),
        family: document.getElementById('family'),
        genus: document.getElementById('genus'),
        author: document.getElementById('author'),
        suggestions: document.getElementById('taxonomy-suggestions'),
        hint: document.getElementById('taxa-hint')
    };

    // State Variables
    let html5QrCode; 
    let cropper; 
    let stream;
    let debounceTimer;
    let currentProcessedBlob = null; // Stores the final image blob waiting to be saved

    // --- 1. CAMERA & INIT ---
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            video.srcObject = stream;
            video.style.display = 'block';
        } catch (err) {
            console.error("Camera Error:", err);
            alert("Please allow camera access.");
        }
    }
    startCamera();

    toggleCameraBtn.addEventListener('click', () => {
        if(stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
            toggleCameraBtn.textContent = "Start Camera";
        } else {
            startCamera();
            toggleCameraBtn.textContent = "Stop Camera";
        }
    });

    // --- 2. BARCODE SCANNING ---
    scanBarcodeBtn.addEventListener('click', () => {
        if(stream) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.style.display = 'none';
        }

        document.getElementById('scan-region-highlight').style.display = 'block';
        html5QrCode = new Html5Qrcode("scanner-container");
        
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } }, 
        (decodedText) => {
            // Success
            inputs.accession.value = decodedText;
            html5QrCode.stop().then(() => {
                document.getElementById('scan-region-highlight').style.display = 'none';
                video.style.display = 'block';
                startCamera(); 
            });
        }, 
        (errorMessage) => {}).catch(err => console.log(err));
    });

    // --- 3. CAPTURE & CROP WORKFLOW ---
    captureBtn.addEventListener('click', () => {
        if (captureBtn.textContent.includes("Capture")) {
            // STEP A: Capture
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Show Preview
            capturedImage.src = canvas.toDataURL('image/jpeg');
            video.style.display = 'none';
            scannerContainer.style.display = 'none';
            previewContainer.style.display = 'block';

            // Init Cropper
            if(cropper) cropper.destroy();
            cropper = new Cropper(capturedImage, {
                viewMode: 1, autoCropArea: 0.8, movable: false, rotatable: true, zoomable: false,
            });

            // Update UI Button
            captureBtn.textContent = "✅ Confirm Crop";
            captureBtn.classList.replace('btn-success', 'btn-warning');

        } else {
            // STEP B: Confirm Crop & Compress
            if(!cropper) return;

            cropper.getCroppedCanvas({ width: 1600 }).toBlob((blob) => {
                currentProcessedBlob = blob; // Store globally
                
                // Feedback to user
                captureBtn.textContent = `Image Ready (${(blob.size/1024).toFixed(0)} KB)`;
                captureBtn.classList.replace('btn-warning', 'btn-secondary');
                captureBtn.disabled = true; // Prevent re-clicking
                
            }, 'image/jpeg', 0.7);
        }
    });

    // --- 4. SMART TAXONOMY ---
    inputs.binomial.addEventListener('input', (e) => {
        const query = e.target.value;
        if (query.length < 3) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSpeciesSuggestions(query), 300);
    });

    async function fetchSpeciesSuggestions(query) {
        const url = `https://api.gbif.org/v1/species/suggest?q=${query}&rank=SPECIES&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            inputs.suggestions.innerHTML = ''; 

            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item.scientificName; 
                inputs.suggestions.appendChild(option);
            });

            const exactMatch = data.find(d => d.scientificName === query);
            if (exactMatch) {
                inputs.family.value = exactMatch.family || "Unknown";
                inputs.genus.value = exactMatch.genus || "Unknown";
                inputs.author.value = exactMatch.authorship || "";
                inputs.hint.textContent = `✅ Verified: ${exactMatch.scientificName}`;
                inputs.hint.classList.replace('text-muted', 'text-success');
            }
        } catch (error) { console.error("GBIF Error:", error); }
    }

    // --- 5. SAVE TO LOCAL DATABASE (Simulate Upload) ---
    saveLocalBtn.addEventListener('click', () => {
        // Validation
        if (!currentProcessedBlob) {
            alert("Please capture and crop an image first!");
            return;
        }
        if (!inputs.accession.value || !inputs.binomial.value) {
            alert("Please fill in Accession Number and Name.");
            return;
        }

        // Create Object
        const specimen = {
            id: inputs.accession.value,
            name: inputs.binomial.value,
            family: inputs.family.value,
            size: (currentProcessedBlob.size / 1024).toFixed(1) + " KB",
            imgUrl: URL.createObjectURL(currentProcessedBlob) // Create local link for preview
        };

        // Add to Table
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><img src="${specimen.imgUrl}" style="height: 50px; width: 50px; object-fit: cover;"></td>
            <td class="fw-bold">${specimen.id}</td>
            <td>${specimen.name}<br><small class="text-muted">${specimen.family}</small></td>
            <td>${specimen.size}</td>
        `;
        localDbBody.prepend(row);

        // RESET FORM for next scan
        resetForm();
    });

    function resetForm() {
        // Reset Inputs
        inputs.accession.value = '';
        inputs.binomial.value = '';
        inputs.family.value = '';
        inputs.genus.value = '';
        inputs.author.value = '';
        inputs.hint.textContent = 'Start typing to search GBIF...';
        inputs.hint.classList.replace('text-success', 'text-muted');

        // Reset Image
        currentProcessedBlob = null;
        if(cropper) cropper.destroy();
        previewContainer.style.display = 'none';
        scannerContainer.style.display = 'block';
        video.style.display = 'block';
        
        // Reset Buttons
        captureBtn.textContent = "📸 Capture Sheet";
        captureBtn.classList.remove('btn-secondary', 'btn-warning');
        captureBtn.classList.add('btn-success');
        captureBtn.disabled = false;
        
        // Ensure Camera is running
        if(!stream) startCamera();
    }
});
