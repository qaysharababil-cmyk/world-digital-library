const API = {
  openLibrary: "https://openlibrary.org/search.json",
  googleBooks: "https://www.googleapis.com/books/v1/volumes",
  gutenberg: "https://gutendex.com/books/",
  archive: "https://archive.org/advancedsearch.php"
};

const state = {
  query: "",
  source: "all",
  books: [],
  page: 1,
  loading: false,
  saved: JSON.parse(localStorage.getItem("wdl-saved") || "[]")
};

const grid = document.getElementById("bookGrid");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const statusText = document.getElementById("searchStatus");
const resultCount = document.getElementById("resultCount");
const loadMoreButton = document.getElementById("loadMore");
const modal = document.getElementById("bookModal");
const modalBody = document.getElementById("modalBody");

function cleanText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value || "Informasi tidak tersedia";
}

function normalizeBook(book) {
  return {
    id: book.id,
    title: cleanText(book.title),
    author: cleanText(book.author),
    year: book.year || "",
    source: book.source,
    cover: book.cover || "",
    description: book.description || "Deskripsi buku belum tersedia.",
    link: book.link || "",
    preview: book.preview || "",
    subjects: book.subjects || []
  };
}

function makeId(source, id) {
  return `${source}-${id}`;
}

async function searchOpenLibrary(query, page) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: "20"
  });

  const response = await fetch(`${API.openLibrary}?${params}`);
  if (!response.ok) throw new Error("Open Library error");

  const data = await response.json();

  return (data.docs || []).map(book => normalizeBook({
    id: makeId("openlibrary", book.key),
    title: book.title,
    author: book.author_name,
    year: book.first_publish_year,
    source: "Open Library",
    cover: book.cover_i
      ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`
      : "",
    description: "",
    link: book.key
      ? `https://openlibrary.org${book.key}`
      : ""
  }));
}

async function searchGoogleBooks(query, page) {
  const startIndex = (page - 1) * 20;
  const params = new URLSearchParams({
    q: query,
    startIndex: String(startIndex),
    maxResults: "20",
    printType: "books"
  });

  const response = await fetch(`${API.googleBooks}?${params}`);
  if (!response.ok) throw new Error("Google Books error");

  const data = await response.json();

  return (data.items || []).map(item => {
    const info = item.volumeInfo || {};
    const images = info.imageLinks || {};

    return normalizeBook({
      id: makeId("google", item.id),
      title: info.title,
      author: info.authors,
      year: info.publishedDate,
      source: "Google Books",
      cover: images.thumbnail || images.smallThumbnail || "",
      description: info.description || "",
      link: info.infoLink || "",
      preview: info.previewLink || ""
    });
  });
}

async function searchGutenberg(query, page) {
  const params = new URLSearchParams({
    search: query,
    page: String(page)
  });

  const response = await fetch(`${API.gutenberg}?${params}`);
  if (!response.ok) throw new Error("Gutenberg error");

  const data = await response.json();

  return (data.results || []).map(book => {
    const formats = book.formats || {};
    const cover = formats["image/jpeg"] || "";
    const readLink =
      formats["text/html"] ||
      formats["text/plain; charset=utf-8"] ||
      formats["application/epub+zip"] ||
      `https://www.gutenberg.org/ebooks/${book.id}`;

    return normalizeBook({
      id: makeId("gutenberg", book.id),
      title: book.title,
      author: (book.authors || []).map(a => a.name),
      year: "",
      source: "Project Gutenberg",
      cover,
      description: "Buku dari koleksi Project Gutenberg.",
      link: `https://www.gutenberg.org/ebooks/${book.id}`,
      preview: readLink
    });
  });
}

async function searchArchive(query, page) {
  const params = new URLSearchParams({
    q: `(${query}) AND mediatype:texts`,
    rows: "20",
    page: String(page),
    output: "json",
    "fl[]": "identifier,title,creator,year,description"
  });

  const response = await fetch(`${API.archive}?${params}`);
  if (!response.ok) throw new Error("Internet Archive error");

  const data = await response.json();

  return (data.response?.docs || []).map(book => {
    const identifier = book.identifier;

    return normalizeBook({
      id: makeId("archive", identifier),
      title: book.title,
      author: book.creator,
      year: book.year,
      source: "Internet Archive",
      cover: identifier
        ? `https://archive.org/services/img/${encodeURIComponent(identifier)}`
        : "",
      description: cleanText(book.description),
      link: `https://archive.org/details/${encodeURIComponent(identifier)}`,
      preview: `https://archive.org/details/${encodeURIComponent(identifier)}`
    });
  });
}

const providers = [
  { name: "Open Library", search: searchOpenLibrary },
  { name: "Google Books", search: searchGoogleBooks },
  { name: "Project Gutenberg", search: searchGutenberg },
  { name: "Internet Archive", search: searchArchive }
];

async function runSearch(append = false) {
  const query = state.query.trim();

  if (!query || state.loading) return;

  state.loading = true;
  loadMoreButton.disabled = true;
  loadMoreButton.textContent = "Memuat...";
  statusText.textContent = "Sedang mencari buku...";

  if (!append) {
    state.books = [];
    state.page = 1;
    grid.innerHTML = "";
  }

  const results = await Promise.allSettled(
    providers.map(provider => provider.search(query, state.page))
  );

  let newBooks = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      newBooks.push(...result.value);
    } else {
      console.warn(
        `${providers[index].name} tidak dapat diakses:`,
        result.reason
      );
    }
  });

  const existingIds = new Set(state.books.map(book => book.id));
  newBooks = newBooks.filter(book => !existingIds.has(book.id));

  state.books.push(...newBooks);
  state.page++;

  renderBooks();

  const successfulSources = results.filter(
    result => result.status === "fulfilled"
  ).length;

  statusText.textContent = successfulSources
    ? `${successfulSources} sumber berhasil dihubungi`
    : "Semua sumber sedang tidak tersedia. Coba lagi nanti.";

  loadMoreButton.hidden = newBooks.length === 0;
  loadMoreButton.disabled = false;
  loadMoreButton.textContent = "Muat Lebih Banyak";
  state.loading = false;
}

function getVisibleBooks() {
  let books = [...state.books];

  if (state.source === "saved") {
    books = state.saved;
  } else if (state.source !== "all") {
    books = books.filter(book => book.source === state.source);
  }

  const sort = document.getElementById("sortSelect").value;

  if (sort === "title") {
    books.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "newest") {
    books.sort((a, b) => String(b.year).localeCompare(String(a.year)));
  }

  return books;
}

function renderBooks() {
  const books = getVisibleBooks();

  resultCount.textContent = `${books.length} buku ditemukan`;

  if (!books.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Buku belum ditemukan</h3>
        <p>Coba kata kunci lain atau pilih sumber yang berbeda.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = books.map(book => {
    const saved = state.saved.some(item => item.id === book.id);

    return `
      <article class="book-card">
        <div class="cover-wrap">
          ${
            book.cover
              ? `<img src="${escapeHTML(book.cover)}"
                   alt="Sampul ${escapeHTML(book.title)}"
                   loading="lazy"
                   onerror="this.style.display='none'">`
              : `<span class="cover-placeholder">WDL</span>`
          }
          <button class="save-button ${saved ? "saved" : ""}"
            data-save="${escapeHTML(book.id)}"
            aria-label="Simpan buku">
            ${saved ? "♥" : "♡"}
          </button>
        </div>
        <div class="book-info">
          <span class="source-label">${escapeHTML(book.source)}</span>
          <h3>${escapeHTML(book.title)}</h3>
          <p class="book-author">${escapeHTML(book.author)}</p>
          <p class="book-year">${escapeHTML(book.year)}</p>
          <button class="detail-button" data-detail="${escapeHTML(book.id)}">
            Lihat Detail
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toggleSave(bookId) {
  const book = state.books.find(item => item.id === bookId)
    || state.saved.find(item => item.id === bookId);

  if (!book) return;

  const exists = state.saved.some(item => item.id === bookId);

  if (exists) {
    state.saved = state.saved.filter(item => item.id !== bookId);
  } else {
    state.saved.push(book);
  }

  localStorage.setItem("wdl-saved", JSON.stringify(state.saved));
  renderBooks();
}

function showDetails(bookId) {
  const book = state.books.find(item => item.id === bookId)
    || state.saved.find(item => item.id === bookId);

  if (!book) return;

  const cover = book.cover
    ? `<img src="${escapeHTML(book.cover)}" alt="Sampul buku">`
    : `<div class="cover-placeholder">WDL</div>`;

  modalBody.innerHTML = `
    <div class="modal-book">
      ${cover}
      <div>
        <span class="source-label">${escapeHTML(book.source)}</span>
        <h2>${escapeHTML(book.title)}</h2>
        <p><b>Penulis:</b> ${escapeHTML(book.author)}</p>
        <p><b>Tahun:</b> ${escapeHTML(book.year)}</p>
        <p>${escapeHTML(book.description)}</p>
        <div class="modal-actions">
          ${
            book.link
              ? `<a href="${escapeHTML(book.link)}"
                   target="_blank" rel="noopener noreferrer">
                   Buka Sumber
                 </a>`
              : ""
          }
          ${
            book.preview
              ? `<a class="secondary"
                   href="${escapeHTML(book.preview)}"
                   target="_blank" rel="noopener noreferrer">
                   Baca / Preview
                 </a>`
              : ""
          }
        </div>
      </div>
    </div>
  `;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

searchForm.addEventListener("submit", event => {
  event.preventDefault();

  state.query = searchInput.value.trim();
  state.source = "all";

  document.querySelectorAll(".filter").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.source === "all"
    );
  });

  if (state.query) runSearch();
});

document.querySelectorAll(".quick-search").forEach(button => {
  button.addEventListener("click", () => {
    searchInput.value = button.textContent;
    state.query = button.textContent;
    state.source = "all";
    runSearch();
    document.getElementById("catalog").scrollIntoView();
  });
});

document.getElementById("filters").addEventListener("click", event => {
  const button = event.target.closest(".filter");
  if (!button) return;

  state.source = button.dataset.source;

  document.querySelectorAll(".filter").forEach(item => {
    item.classList.toggle("active", item === button);
  });

  renderBooks();
});

grid.addEventListener("click", event => {
  const saveButton = event.target.closest("[data-save]");
  const detailButton = event.target.closest("[data-detail]");

  if (saveButton) {
    toggleSave(saveButton.dataset.save);
  }

  if (detailButton) {
    showDetails(detailButton.dataset.detail);
  }
});

document.getElementById("sortSelect").addEventListener("change", renderBooks);

loadMoreButton.addEventListener("click", () => runSearch(true));

document.getElementById("savedNav").addEventListener("click", () => {
  state.source = "saved";

  document.querySelectorAll(".filter").forEach(button => {
    button.classList.remove("active");
  });

  renderBooks();
  document.getElementById("catalog").scrollIntoView();
});

function closeModal() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalBackdrop").addEventListener("click", closeModal);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});
