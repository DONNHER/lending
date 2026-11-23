<?php

namespace App\Support;

/** Compatibility with the original Node SQLite password hashes. */
final class LegacyPassword
{
    private const MASK = 0xffffffff;
    private const BLOCKS = 16;
    private const COST = 16384;

    public static function isLegacy(string $hash): bool
    {
        return preg_match('/\A[a-f0-9]{64}\z/', $hash) === 1;
    }

    public static function verify(string $password, string $hash): bool
    {
        if (!self::isLegacy($hash)) {
            return password_verify($password, $hash);
        }

        // Node used RFC 7914 scrypt with N=16384, r=8, p=1 and a 32-byte result.
        $block = hash_pbkdf2('sha256', $password, 'argivit-coop-salt-v1', 1, 1024, true);
        $memory = [];
        for ($i = 0; $i < self::COST; $i++) {
            $memory[$i] = $block;
            $block = self::mix($block);
        }
        for ($i = 0; $i < self::COST; $i++) {
            $index = unpack('V', $block, 960)[1] & (self::COST - 1);
            $block = self::mix($block ^ $memory[$index]);
        }

        return hash_equals($hash, hash_pbkdf2('sha256', $password, $block, 1, 64));
    }

    private static function mix(string $input): string
    {
        $previous = substr($input, 960, 64);
        $even = '';
        $odd = '';
        for ($i = 0; $i < self::BLOCKS; $i++) {
            $previous = self::salsa8($previous ^ substr($input, $i * 64, 64));
            if (($i & 1) === 0) {
                $even .= $previous;
            } else {
                $odd .= $previous;
            }
        }

        return $even.$odd;
    }

    private static function salsa8(string $input): string
    {
        $words = array_values(unpack('V16', $input));
        $state = $words;
        for ($round = 0; $round < 4; $round++) {
            self::quarter($state, 0, 4, 8, 12);
            self::quarter($state, 5, 9, 13, 1);
            self::quarter($state, 10, 14, 2, 6);
            self::quarter($state, 15, 3, 7, 11);
            self::quarter($state, 0, 1, 2, 3);
            self::quarter($state, 5, 6, 7, 4);
            self::quarter($state, 10, 11, 8, 9);
            self::quarter($state, 15, 12, 13, 14);
        }
        for ($i = 0; $i < 16; $i++) {
            $state[$i] = ($state[$i] + $words[$i]) & self::MASK;
        }

        return pack('V*', ...$state);
    }

    private static function quarter(array &$state, int $a, int $b, int $c, int $d): void
    {
        $sum = ($state[$a] + $state[$d]) & self::MASK;
        $state[$b] ^= (($sum << 7) & self::MASK) | ($sum >> 25);
        $sum = ($state[$b] + $state[$a]) & self::MASK;
        $state[$c] ^= (($sum << 9) & self::MASK) | ($sum >> 23);
        $sum = ($state[$c] + $state[$b]) & self::MASK;
        $state[$d] ^= (($sum << 13) & self::MASK) | ($sum >> 19);
        $sum = ($state[$d] + $state[$c]) & self::MASK;
        $state[$a] ^= (($sum << 18) & self::MASK) | ($sum >> 14);
    }
}
