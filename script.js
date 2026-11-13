const API={
  openLibrary:"https://openlibrary.org/search.json",
  googleBooks:"https://www.googleapis.com/books/v1/volumes",
  gutenberg:"https://gutendex.com/books/",
  archive:"https://archive.org/advancedsearch.php"
};
const state={
  query:"",source:"all",books:[],page:1,loading:false,
  saved:loadSaved(),savedView:false
};
const $=id=>document.getElementById(id);
const grid=$("bookGrid"),searchForm=$("searchForm"),searchInput=$("searchInput");
const statusText=$("searchStatus"),resultCount=$("resultCount"),loadMoreButton=$("loadMore");
const modal=$("bookModal"),modalBody=$("modalBody"),reader=$("reader");

function loadSaved(){
  try{const data=JSON.parse(localStorage.getItem("wdl-saved")||"[]");return Array.isArray(data)?data:[]}
  catch{return []}
}
function cleanText(value){if(Array.isArray(value))return value.filter(Boolean).join(", ");return value??""}
function normalizeBook(book){
  return {id:String(book.id||""),title:cleanText(book.title)||"Judul tidak tersedia",
    author:cleanText(book.author)||"Penulis tidak diketahui",year:cleanText(book.year),
    source:book.source,cover:book.cover||"",description:book.description||"Deskripsi buku belum tersedia.",
    link:book.link||"",preview:book.preview||"",readType:book.readType||"",subjects:book.subjects||[]};
}
function makeId(source,id){return `${source}-${id}`}
async function fetchJSON(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchOpenLibrary(query,page){
  const params=new URLSearchParams({q:query,page:String(page),limit:"20"});
  const data=await fetchJSON(`${API.openLibrary}?${params}`);
  return(data.docs||[]).map(book=>{
    const key=book.key||"";
    return normalizeBook({id:makeId("openlibrary",key),title:book.title,author:book.author_name,
      year:book.first_publish_year,source:"Open Library",
      cover:book.cover_i?`https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`:"",
      description:"Informasi bibliografi dari Open Library.",
      link:key?`https://openlibrary.org${key}`:"",
      preview:book.ia?.[0]?`https://archive.org/details/${encodeURIComponent(book.ia[0])}`:"",
      readType:book.ia?.[0]?"archive":"none"});
  });
}

async function searchGoogleBooks(query,page){
  const params=new URLSearchParams({q:query,startIndex:String((page-1)*20),maxResults:"20",printType:"books"});
  const data=await fetchJSON(`${API.googleBooks}?${params}`);
  return(data.items||[]).map(item=>{
    const info=item.volumeInfo||{},images=info.imageLinks||{};
    const id=item.id||"";
    return normalizeBook({id:makeId("google",id),title:info.title,author:info.authors,
      year:info.publishedDate,source:"Google Books",
      cover:(images.thumbnail||images.smallThumbnail||"").replace("http://","https://"),
      description:info.description||"Deskripsi belum tersedia.",
      link:info.infoLink||`https://books.google.com/books?id=${encodeURIComponent(id)}`,
      preview:info.previewLink||`https://books.google.com/books?id=${encodeURIComponent(id)}&printsec=frontcover&output=embed`,
      readType:"google"});
  });
}

async function searchGutenberg(query,page){
  const params=new URLSearchParams({search:query,page:String(page)});
  const data=await fetchJSON(`${API.gutenberg}?${params}`);
  return(data.results||[]).map(book=>{
    const formats=book.formats||{},id=book.id;
    const html=formats["text/html"]||formats["text/html; charset=utf-8"]||"";
    const plain=formats["text/plain; charset=utf-8"]||formats["text/plain"]||"";
    const epub=formats["application/epub+zip"]||"";
    const readURL=html||plain||"";
    return normalizeBook({id:makeId("gutenberg",id),title:book.title,
      author:(book.authors||[]).map(a=>a.name),source:"Project Gutenberg",
      cover:formats["image/jpeg"]||"",description:"Buku dari koleksi Project Gutenberg.",
      link:`https://www.gutenberg.org/ebooks/${id}`,
      preview:readURL||epub||`https://www.gutenberg.org/ebooks/${id}`,
      readType:html?"iframe":plain?"text":epub?"external":"none"});
  });
}

async function searchArchive(query,page){
  const params=new URLSearchParams({q:`(${query}) AND mediatype:texts`,rows:"20",page:String(page),
    output:"json","fl[]":"identifier,title,creator,year,description"});
  const data=await fetchJSON(`${API.archive}?${params}`);
  return(data.response?.docs||[]).map(book=>{
    const id=book.identifier||"";
    return normalizeBook({id:makeId("archive",id),title:book.title,author:book.creator,
      year:book.year,source:"Internet Archive",
      cover:id?`https://archive.org/services/img/${encodeURIComponent(id)}`:"",
      description:cleanText(book.description)||"Informasi dari Internet Archive.",
      link:id?`https://archive.org/details/${encodeURIComponent(id)}`:"",
      preview:id?`https://archive.org/stream/${encodeURIComponent(id)}`:"",
      readType:"archive"});
  });
}

const providers=[
  {name:"Open Library",search:searchOpenLibrary},
  {name:"Google Books",search:searchGoogleBooks},
  {name:"Project Gutenberg",search:searchGutenberg},
  {name:"Internet Archive",search:searchArchive}
];

async function runSearch(append=false){
  const query=state.query.trim();if(!query||state.loading)return;
  state.loading=true;loadMoreButton.disabled=true;loadMoreButton.textContent="Memuat...";
  statusText.textContent="Sedang mencari buku...";
  if(!append){state.books=[];state.page=1;grid.innerHTML="";}
  try{
    const results=await Promise.allSettled(providers.map(provider=>provider.search(query,state.page)));
    let newBooks=[];
    results.forEach((result,index)=>{
      if(result.status==="fulfilled")newBooks.push(...result.value);
      else console.warn(`${providers[index].name} tidak dapat diakses:`,result.reason);
    });
    const existing=new Set(state.books.map(book=>book.id));
    newBooks=newBooks.filter(book=>book.id&&!existing.has(book.id));
    state.books.push(...newBooks);state.page++;
    state.savedView=false;state.source="all";renderBooks();
    const success=results.filter(result=>result.status==="fulfilled").length;
    statusText.textContent=success?`${success} dari 4 sumber berhasil dihubungi`:"Semua sumber sedang tidak tersedia. Coba lagi nanti.";
    loadMoreButton.hidden=newBooks.length===0;
    if(!newBooks.length&&append)statusText.textContent="Tidak ada hasil tambahan untuk halaman ini.";
  }catch(error){
    console.error(error);statusText.textContent="Terjadi kendala saat mencari. Periksa koneksi lalu coba lagi.";
    if(!append)grid.innerHTML='<div class="empty-state"><h3>Pencarian belum berhasil</h3><p>Periksa koneksi internet lalu coba lagi.</p></div>';
  }finally{
    state.loading=false;loadMoreButton.disabled=false;loadMoreButton.textContent="Muat Lebih Banyak";
  }
}

function getVisibleBooks(){
  let books=state.savedView?[...state.saved]:[...state.books];
  if(!state.savedView&&state.source!=="all")books=books.filter(book=>book.source===state.source);
  const sort=$("sortSelect").value;
  if(sort==="title")books.sort((a,b)=>a.title.localeCompare(b.title));
  if(sort==="newest")books.sort((a,b)=>String(b.year).localeCompare(String(a.year)));
  return books;
}

function escapeHTML(value){
  return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
}

function renderBooks(){
  const books=getVisibleBooks();resultCount.textContent=`${books.length} buku ${state.savedView?"tersimpan":"ditemukan"}`;
  $("savedCount").textContent=state.saved.length;
  if(!books.length){
    grid.innerHTML=`<div class="empty-state"><h3>${state.savedView?"Belum ada buku tersimpan":"Buku belum ditemukan"}</h3><p>${state.savedView?"Tekan ikon ♡ pada buku untuk menyimpannya di sini.":"Coba kata kunci lain atau pilih sumber yang berbeda."}</p></div>`;
    return;
  }
  grid.innerHTML=books.map(book=>{
    const saved=state.saved.some(item=>item.id===book.id);
    return `<article class="book-card"><div class="cover-wrap">
      ${book.cover?`<img src="${escapeHTML(book.cover)}" alt="Sampul ${escapeHTML(book.title)}" loading="lazy" onerror="this.hidden=true">`:'<span class="cover-placeholder">WDL</span>'}
      <button class="save-button ${saved?"saved":""}" data-save="${escapeHTML(book.id)}" type="button" aria-label="${saved?"Hapus dari":"Simpan"} buku">${saved?"♥":"♡"}</button>
      </div><div class="book-info"><span class="source-label">${escapeHTML(book.source)}</span>
      <h3>${escapeHTML(book.title)}</h3><p class="book-author">${escapeHTML(book.author)}</p>
      <p class="book-year">${escapeHTML(book.year)}</p>
      <button class="detail-button" data-detail="${escapeHTML(book.id)}" type="button">Lihat Detail</button></div></article>`;
  }).join("");
}

function findBook(id){return state.books.find(book=>book.id===id)||state.saved.find(book=>book.id===id)}

function toggleSave(id){
  const book=findBook(id);if(!book)return;
  const exists=state.saved.some(item=>item.id===id);
  state.saved=exists?state.saved.filter(item=>item.id!==id):[...state.saved,book];
  try{localStorage.setItem("wdl-saved",JSON.stringify(state.saved));}
  catch(error){statusText.textContent="Penyimpanan browser penuh atau tidak tersedia.";}
  renderBooks();
}

function safeURL(value){
  try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)?url.href:"";}
  catch{return "";}
}

function showDetails(id){
  const book=findBook(id);if(!book)return;
  const cover=book.cover?`<img src="${escapeHTML(book.cover)}" alt="Sampul buku">`:'<div class="cover-placeholder">WDL</div>';
  const canRead=book.readType&&book.readType!=="none";
  modalBody.innerHTML=`<div class="modal-book">${cover}<div>
    <span class="source-label">${escapeHTML(book.source)}</span><h2 id="detailTitle">${escapeHTML(book.title)}</h2>
    <p><b>Penulis:</b> ${escapeHTML(book.author||"Tidak tersedia")}</p>
    <p><b>Tahun:</b> ${escapeHTML(book.year||"Tidak tersedia")}</p>
    <p>${escapeHTML(book.description)}</p>
    <div class="modal-actions">
      ${canRead?'<button id="readBookButton" type="button">Baca di website</button>':""}
      ${safeURL(book.link)?`<a class="secondary" href="${escapeHTML(safeURL(book.link))}" target="_blank" rel="noopener noreferrer">Halaman sumber ↗</a>`:""}
      ${!canRead&&safeURL(book.preview)?`<a class="secondary" href="${escapeHTML(safeURL(book.preview))}" target="_blank" rel="noopener noreferrer">Baca / Preview ↗</a>`:""}
    </div></div></div>`;
  modal.classList.add("show");modal.setAttribute("aria-hidden","false");
  const readButton=$("readBookButton");if(readButton)readButton.addEventListener("click",()=>openReader(book));
}

function openReader(book){
  const original=safeURL(book.link);$("readerTitle").textContent=book.title;
  $("readerSource").textContent=book.source;
  $("readerOriginal").href=original||safeURL(book.preview)||"#";
  $("readerFallbackLink").href=original||safeURL(book.preview)||"#";
  const frame=$("readerFrame"),fallback=$("readerFallback");
  fallback.hidden=true;frame.hidden=false;frame.src="about:blank";
  let url="";
  if(book.readType==="google")url=safeURL(book.preview);
  else if(book.readType==="iframe")url=safeURL(book.preview);
  else if(book.readType==="archive")url=safeURL(book.preview);
  else if(book.readType==="text")url=safeURL(book.preview);
  if(!url){
    frame.hidden=true;fallback.hidden=false;
  }else{
    frame.src=url;
    $("readerNotice").textContent=book.source==="Google Books"
      ?"Pratinjau Google Books ditampilkan jika penerbit mengizinkannya."
      :book.source==="Project Gutenberg"
      ?"Buku berasal dari koleksi Project Gutenberg. Gunakan kontrol pada pembaca untuk menavigasi teks."
      :"Tampilan buku disediakan oleh Internet Archive dan mengikuti ketentuan aksesnya.";
  }
  modal.classList.remove("show");modal.setAttribute("aria-hidden","true");
  reader.classList.add("show");reader.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
}

function closeReader(){
  reader.classList.remove("show");reader.setAttribute("aria-hidden","true");
  $("readerFrame").src="about:blank";document.body.style.overflow="";
}

searchForm.addEventListener("submit",event=>{
  event.preventDefault();state.query=searchInput.value.trim();if(!state.query)return;
  state.savedView=false;state.source="all";
  document.querySelectorAll(".filter").forEach(button=>button.classList.toggle("active",button.dataset.source==="all"));
  runSearch();$("catalog").scrollIntoView({behavior:"smooth"});
});

document.querySelectorAll(".quick-search").forEach(button=>button.addEventListener("click",()=>{
  searchInput.value=button.textContent;state.query=button.textContent;state.savedView=false;
  runSearch();$("catalog").scrollIntoView({behavior:"smooth"});
}));

$("filters").addEventListener("click",event=>{
  const button=event.target.closest(".filter");if(!button)return;
  state.savedView=false;state.source=button.dataset.source;
  document.querySelectorAll(".filter").forEach(item=>item.classList.toggle("active",item===button));
  renderBooks();
});

grid.addEventListener("click",event=>{
  const save=event.target.closest("[data-save]"),detail=event.target.closest("[data-detail]");
  if(save)toggleSave(save.dataset.save);
  if(detail)showDetails(detail.dataset.detail);
});

$("sortSelect").addEventListener("change",renderBooks);
loadMoreButton.addEventListener("click",()=>runSearch(true));

$("savedNav").addEventListener("click",()=>{
  state.savedView=true;state.source="saved";
  document.querySelectorAll(".filter").forEach(button=>button.classList.remove("active"));
  renderBooks();$("catalog").scrollIntoView({behavior:"smooth"});
});

function closeModal(){modal.classList.remove("show");modal.setAttribute("aria-hidden","true")}
$("modalClose").addEventListener("click",closeModal);
modal.addEventListener("click",event=>{if(event.target.dataset.close==="details")closeModal()});
$("readerBack").addEventListener("click",closeReader);

document.addEventListener("keydown",event=>{
  if(event.key==="Escape"){closeModal();closeReader()}
});

renderBooks();
