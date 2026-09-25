-- Buat database
CREATE DATABASE IF NOT EXISTS buku_tamu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE buku_tamu;

-- Tabel master_sekolah
CREATE TABLE IF NOT EXISTS master_sekolah (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_sekolah VARCHAR(150) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel buku_tamu
CREATE TABLE IF NOT EXISTS buku_tamu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sekolah_id INT NOT NULL,
    other_instansi VARCHAR(100) NULL DEFAULT NULL,
    nama_lengkap VARCHAR(100) NOT NULL,
    nomor_wa VARCHAR(15),
    foto LONGTEXT,
    kode VARCHAR(15) NULL DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_buku_tamu_created_at (created_at),
    KEY idx_buku_tamu_kode (kode),
    FOREIGN KEY (sekolah_id) REFERENCES master_sekolah(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel super_admin
CREATE TABLE IF NOT EXISTS super_admin (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    whatsapp VARCHAR(15),
    password VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel wheel_spin (untuk menyimpan pemenang undian, satu tamu hanya bisa menang sekali)
CREATE TABLE IF NOT EXISTS wheel_spin (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tamu_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wheel_spin_tamu (tamu_id),
    FOREIGN KEY (tamu_id) REFERENCES buku_tamu(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel sessions dibuat otomatis oleh aplikasi (express-mysql-session)

-- Insert data sample sekolah
INSERT INTO master_sekolah (nama_sekolah) VALUES
('SMK Negeri 1 Jakarta'),
('SMK Negeri 2 Jakarta'),
('SMK Muhammadiyah 1'),
('SMK Telkom Jakarta'),
('SMA Negeri 1 Jakarta');

-- Akun admin TIDAK dibuat di sini.
-- Buat admin dengan: npm run seed:admin
