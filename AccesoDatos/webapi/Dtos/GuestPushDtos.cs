using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos;

public sealed class GuestPushSubscriptionDto
{
    [Required, StringLength(2048)] public string Endpoint { get; set; } = "";
    [Required] public GuestPushKeysDto Keys { get; set; } = new();
}

public sealed class GuestPushKeysDto
{
    [Required, StringLength(100)] public string P256dh { get; set; } = "";
    [Required, StringLength(100)] public string Auth { get; set; } = "";
}
