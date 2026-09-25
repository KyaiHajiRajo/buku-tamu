const MAX_INISIAL = 6;

/**
 * Buat kode undian tamu: [Inisial][01][ID minimal 2 digit]
 * Contoh: Dimas Putra dengan ID 5 → DP0105
 *
 * Inisial hanya huruf A-Z (aksen dihapus) dan maksimal 6 huruf,
 * sehingga kode selalu muat di kolom VARCHAR(15).
 */
const buatKode = (namaLengkap, id) => {
  const inisial = String(namaLengkap || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .map((word) => (word.match(/[A-Z]/) || [""])[0])
    .join("")
    .slice(0, MAX_INISIAL);

  return `${inisial || "X"}01${String(id).padStart(2, "0")}`;
};

module.exports = { buatKode };
